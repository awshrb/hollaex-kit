'use strict';

const { SERVER_PATH } = require('../constants');
const { sendEmail } = require(`${SERVER_PATH}/mail`);
const { MAILTYPE } = require(`${SERVER_PATH}/mail/strings`);
const { WITHDRAWALS_REQUEST_KEY } = require(`${SERVER_PATH}/constants`);
const { verifyOtpBeforeAction, checkCaptcha } = require('./auth');
const { subscribedToCoin, getKitCoin, getKitSecrets } = require('./common');
const {
	INVALID_OTP_CODE,
	INVALID_WITHDRAWAL_TOKEN,
	EXPIRED_WITHDRAWAL_TOKEN
} = require('../messages');
const { getUserByKitId } = require('./users');
const { client } = require('./database/redis');
const crypto = require('crypto');
const uuid = require('uuid/v4');
const { all, reject } = require('bluebird');
const { getNodeLib } = require(`${SERVER_PATH}/init`);

// const validateWithdraw = (currency, address, amount) => {

// };

const sendRequestWithdrawalEmail = (id, address, amount, currency, otpCode, captcha, ip, domain) => {
	if (!subscribedToCoin(currency)) {
		return reject(new Error(`Invalid currency: "${currency}"`));
	}

	if (amount <= 0) {
		return reject(new Error('Invalid amount'));
	}

	if (!getKitCoin(currency).allow_withdrawal) {
		return reject(new Error(`Withdrawals are disabled for ${currency}`));
	}

	return checkCaptcha(captcha, ip)
		.then(() => verifyOtpBeforeAction(id, otpCode))
		.then((validOtp) => {
			if (!validOtp) {
				throw new Error(INVALID_OTP_CODE);
			}
			return getUserByKitId(id);
		})
		.then((user) => {
			if (user.verification_level < 1) {
				throw new Error('Upgrade verification levle');
			}
			return withdrawRequestEmail(
				user,
				{
					user_id: id,
					email: user.email,
					amount,
					fee: getKitCoin(currency).withdrawal_fee,
					transaction_id: uuid(),
					address,
					currency
				},
				domain,
				ip
			);
		});
};

const withdrawRequestEmail = (user, data, domain, ip) => {
	data.timestamp = Date.now();
	let stringData = JSON.stringify(data);
	const token = crypto.randomBytes(60).toString('hex');

	return client.hsetAsync(WITHDRAWALS_REQUEST_KEY, token, stringData)
		.then(() => {
			const { email, amount, fee, currency, address } = data;
			sendEmail(
				MAILTYPE.WITHDRAWAL_REQUEST,
				email,
				{
					amount: amount,
					fee: fee,
					currency: currency,
					transaction_id: token,
					address: address,
					ip: ip
				},
				user.settings,
				domain
			);
			return data;
		});
};

const validateWithdrawalToken = (token) => {
	return client.hgetAsync(WITHDRAWALS_REQUEST_KEY, token)
		.then((withdrawal) => {
			if (!withdrawal) {
				throw new Error(INVALID_WITHDRAWAL_TOKEN);
			} else {
				withdrawal = JSON.parse(withdrawal);

				client.hdelAsync(WITHDRAWALS_REQUEST_KEY, token);

				if (Date.now() - withdrawal.timestamp > getKitSecrets.security.withdrawal_token_expiry) {
					throw new Error(EXPIRED_WITHDRAWAL_TOKEN);
				} else {
					return withdrawal;
				}
			}
		});
};

const cancelUserWithdrawal = (userId, transactionId) => {
	return getUserByKitId(userId)
		.then((user) => {
			return getNodeLib().cancelWithdrawalNetwork(user.network_id, transactionId);
		});
};

const checkTransaction = (currency, transactionId, address, isTestnet = false) => {
	if (!subscribedToCoin(currency)) {
		return reject(new Error('Invalid currency'));
	}

	return getNodeLib().checkTransactionNetwork(currency, transactionId, address, isTestnet);
};

const performWithdrawal = (userId, address, currency, amount, fee, otpCode) => {
	if (!subscribedToCoin(currency)) {
		return reject(new Error('Invalid currency'));
	}
	return getUserByKitId(userId)
		.then((user) => {
			return getNodeLib().createWithdrawalNetwork(user.network_id, address, currency, amount, fee, otpCode);
		});
};

module.exports = {
	sendRequestWithdrawalEmail,
	validateWithdrawalToken,
	cancelUserWithdrawal,
	checkTransaction,
	performWithdrawal
};
