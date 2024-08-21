'use strict';

const { getModel } = require('./database/model');
const { SERVER_PATH } = require('../constants');
const { getNodeLib } = require(`${SERVER_PATH}/init`);
const { P2P_SUPPORTED_PLANS } = require(`${SERVER_PATH}/constants`);
const { getUserByKitId } = require('./user');
const { subscribedToCoin, getKitConfig, subscribedToPair } = require('./common');
const { transferAssetByKitIds, getUserBalanceByKitId } = require('./wallet');
const { testBroker } = require('./broker');
const { Op } = require('sequelize');
const BigNumber = require('bignumber.js');
const { getKitCoin } = require('./common');
const { paginationQuery, timeframeQuery, orderingQuery } = require('./database/helpers');
const dbQuery = require('./database/query');
const uuid = require('uuid/v4');
const { parse } = require('json2csv');
const moment = require('moment');
const { client } = require('./database/redis');
const { sendEmail } = require('../../../mail');
const { MAILTYPE } = require('../../../mail/strings');

const {
	NO_DATA_FOR_CSV,
    FUNDING_ACCOUNT_INSUFFICIENT_BALANCE,
    USER_NOT_FOUND,
	P2P_DEAL_NOT_FOUND
} = require(`${SERVER_PATH}/messages`);


const fetchP2PDisputes = async (opts = {
	user_id: null,
    limit: null,
    page: null,
    order_by: null,
    order: null,
    start_date: null,
    end_date: null,
    format: null
}) => {
    const pagination = paginationQuery(opts.limit, opts.page);
	const ordering = orderingQuery(opts.order_by, opts.order);
	const timeframe = timeframeQuery(opts.start_date, opts.end_date);

	const query = {
		where: {
			created_at: timeframe,
			...(opts.user_id && { initiator_id: opts.user_id }),
			
		},
		order: [ordering],
		...(!opts.format && pagination),
	};

	if (opts.format) {
		return dbQuery.fetchAllRecords('p2pDispute', query)
			.then((data) => {
				if (opts.format && opts.format === 'csv') {
					if (data.data.length === 0) {
						throw new Error(NO_DATA_FOR_CSV);
					}
					const csv = parse(data.data, Object.keys(data.data[0]));
					return csv;
				} else {
					return data;
				}
			});
	} else {
        return dbQuery.findAndCountAllWithRows('p2pDispute', query);
	}
};

const fetchP2PDeals = async (opts = {
	user_id: null,
	status: null,
    limit: null,
    page: null,
    order_by: null,
    order: null,
    start_date: null,
    end_date: null,
    format: null
}) => {
    const pagination = paginationQuery(opts.limit, opts.page);
	const ordering = orderingQuery(opts.order_by, opts.order);
	const timeframe = timeframeQuery(opts.start_date, opts.end_date);

	const query = {
		where: {
			created_at: timeframe,
			...(opts.user_id && { merchant_id: opts.user_id }),
			...(opts.status && { status: opts.status }),
			
		},
		order: [ordering],
		...(!opts.format && pagination),
		include: [
			{
				model: getModel('user'),
				as: 'merchant',
				attributes: ['id', 'full_name']
			}
		]
	};

	if (opts.format) {
		return dbQuery.fetchAllRecords('p2pDeal', query)
			.then((data) => {
				if (opts.format && opts.format === 'csv') {
					if (data.data.length === 0) {
						throw new Error(NO_DATA_FOR_CSV);
					}
					const csv = parse(data.data, Object.keys(data.data[0]));
					return csv;
				} else {
					return data;
				}
			});
	} else {
		const p2pDeals = await client.getAsync(`p2p-deals`);

		if (p2pDeals) return JSON.parse(p2pDeals);
		else {
			const deals = await dbQuery.findAndCountAllWithRows('p2pDeal', query);
			const brokers = await getModel('broker').findAll({ type: 'dynamic' });
			for (let deal of (deals?.data || [])) {
				if (deal.dynamic_pair) {
					const broker = brokers.find(broker => broker.symbol === deal.dynamic_pair);
					const { formula, increment_size } = broker;
		
					const result = await testBroker({
						formula,
						increment_size,
						spread: 1
					});

					deal.exchange_rate = result.buy_price;
				}
			}

			await client.setexAsync(`p2p-deals`, 30, JSON.stringify(deals));
			return deals;
		}
	}
};

const fetchP2PTransactions = async (user_id, opts = {
	id: null,
    limit: null,
    page: null,
    order_by: null,
    order: null,
    start_date: null,
    end_date: null,
    format: null
}) => {

	const pagination = paginationQuery(opts.limit, opts.page);
	const ordering = orderingQuery(opts.order_by, opts.order);
	const timeframe = timeframeQuery(opts.start_date, opts.end_date);

	const query = {
		where: {
			created_at: timeframe,
			...(opts.id && { id: opts.id }),
			[Op.or]: [
				{ merchant_id: user_id },
				{ user_id },
			]
			
		},
		order: [ordering],
		...(!opts.format && pagination),
		include: [
			{
				model: getModel('p2pDeal'),
				as: 'deal',
			},
			{
				model: getModel('user'),
				as: 'merchant',
				attributes: ['id', 'full_name']
			},
			{
				model: getModel('user'),
				as: 'buyer',
				attributes: ['id', 'full_name']
			},
		]
	};

	if (opts.format) {
		return dbQuery.fetchAllRecords('p2pTransaction', query)
			.then((data) => {
				if (opts.format && opts.format === 'csv') {
					if (data.data.length === 0) {
						throw new Error(NO_DATA_FOR_CSV);
					}
					const csv = parse(data.data, Object.keys(data.data[0]));
					return csv;
				} else {
					return data;
				}
			});
	} else {
        return dbQuery.findAndCountAllWithRows('p2pTransaction', query);
	}
};

const getP2PAccountBalance = async (account_id, coin) => {
        
    const balance = await getUserBalanceByKitId(account_id);
    let symbols = {};

    for (const key of Object.keys(balance)) {
        if (key.includes('available') && balance[key] != null) {
            let symbol = key?.split('_')?.[0];
            symbols[symbol] = balance[key];
        }
    }

    return symbols[coin];
};

const createP2PDeal = async (data) => {
	let {
		merchant_id,
		buying_asset,
		spending_asset,
		spread,
		exchange_rate,
		total_order_amount,
		min_order_value,
		max_order_value,
		price_type,
		dynamic_pair,
    } = data;
        
    const exchangeInfo = getKitConfig().info;

    if(!P2P_SUPPORTED_PLANS.includes(exchangeInfo.plan)) {
        throw new Error('Service not supported by your exchange plan');
    }

	const p2pConfig = getKitConfig()?.p2p_config;

	const merchant = await getUserByKitId(merchant_id);

	//Check Merhcant Tier
	if (p2pConfig.starting_merchant_tier > merchant.verification_level) {
		throw new Error('Your tier does not support creating P2P deals');
	};

	if (!subscribedToCoin(spending_asset)) {
        throw new Error('Invalid coin ' + spending_asset);
    };

	if (!subscribedToCoin(buying_asset)) {
        throw new Error('Invalid coin ' + buying_asset);
    };

	if (price_type === 'dynamic' && !subscribedToPair(dynamic_pair)) {
        throw new Error('Invalid pair ' + dynamic_pair);
    };

	const balance = await getP2PAccountBalance(merchant_id, buying_asset);

	if (new BigNumber(balance).comparedTo(new BigNumber(total_order_amount)) !== 1) {
        throw new Error(FUNDING_ACCOUNT_INSUFFICIENT_BALANCE);
    };

	if (min_order_value < 0) {
		throw new Error('min order alue cannot be less than 0');
	};

	if (max_order_value < 0) {
		throw new Error('max order value cannot be less than 0');
	};

	if (min_order_value > max_order_value) {
		throw new Error('min order value cannot be bigger than max order value');
	};

	if (spread < 0) {
		throw new Error('spread cannot be less than 0');
	};

	if (price_type === 'static' && exchange_rate < 0) {
		throw new Error('exchange rate cannot be less than 0');
	};

	data.status = true;


	return getModel('p2pDeal').create(data, {
		fields: [
			'merchant_id',
			'side',
			'price_type',
			'buying_asset',
			'spending_asset',
			'exchange_rate',
			'dynamic_pair',
			'spread',
			'total_order_amount',
			'min_order_value',
			'max_order_value',
			'terms',
			'auto_response',
			'payment_methods',
			'status',
			'region'
		]
	});
};

const updateP2PDeal = async (data) => {
	let {
		id,
		edited_ids,
		merchant_id,
		buying_asset,
		spending_asset,
		spread,
		exchange_rate,
		total_order_amount,
		min_order_value,
		max_order_value,
		price_type,
		dynamic_pair,
		payment_method_used,
		status,
    } = data;
        
    const exchangeInfo = getKitConfig().info;

    if (!P2P_SUPPORTED_PLANS.includes(exchangeInfo.plan)) {
        throw new Error('Service not supported by your exchange plan');
    }

	if (edited_ids != null) {
		const deals = await getModel('p2pDeal').findAll({
			where: {
				id: edited_ids
			}
		});

		deals.forEach(deal => {
			if (deal.merchant_id !== merchant_id) {
				throw new Error('Merchant id is not the same');
			}
		});
		await getModel('p2pDeal').update({ status }, { where : { id : edited_ids }}); 
		return { message : 'success' };
	}

	const p2pDeal = await getModel('p2pDeal').findOne({ where: { id } });
    if (!p2pDeal) {
        throw new Error('deal does not exist');
    }

	if(p2pDeal.merchant_id !== merchant_id) {
		throw new Error('Merchant Id is not the same');
	}

	//Check Merhcant Tier

	if (!subscribedToCoin(spending_asset)) {
        throw new Error('Invalid coin ' + spending_asset);
    };

	if (!subscribedToCoin(buying_asset)) {
        throw new Error('Invalid coin ' + buying_asset);
    };

	if (price_type === 'dynamic' && !subscribedToPair(dynamic_pair)) {
        throw new Error('Invalid pair ' + dynamic_pair);
    };

	const balance = await getP2PAccountBalance(merchant_id, buying_asset);

	if (new BigNumber(balance).comparedTo(new BigNumber(total_order_amount)) !== 1) {
        throw new Error(FUNDING_ACCOUNT_INSUFFICIENT_BALANCE);
    };
	if (min_order_value < 0) {
			throw new Error('min order alue cannot be less than 0');
	};

	if (max_order_value < 0) {
		throw new Error('max order value cannot be less than 0');
	};

	if (min_order_value > max_order_value) {
		throw new Error('min order value cannot be bigger than max order value');
	};

	if (spread < 0) {
		throw new Error('spread cannot be less than 0');
	};

	if (price_type === 'static' && exchange_rate < 0) {
		throw new Error('exchange rate cannot be less than 0');
	};


	if (data.status == null) {
		data.status = true;
	};

	return p2pDeal.update(data, {
		fields: [
			'merchant_id',
			'side',
			'price_type',
			'buying_asset',
			'spending_asset',
			'exchange_rate',
			'dynamic_pair',
			'spread',
			'total_order_amount',
			'min_order_value',
			'max_order_value',
			'terms',
			'auto_response',
			'payment_methods',
			'status',
			'region'
		]
	});
};

const deleteP2PDeal = async (removed_ids, user_id) => {
	const deals = await getModel('p2pDeal').findAll({
		where: {
			id: removed_ids,
			merchant_id: user_id 
		}
	});

	if (deals?.length === 0) {
		throw new Error(P2P_DEAL_NOT_FOUND);
	};


	const promises = deals.map(async (deal) => {
		return await deal.destroy();
	  });
	
	  const results = await Promise.all(promises);
	  return results;
};


const createP2PTransaction = async (data) => {
	let {
		deal_id,
		user_id,
		amount_fiat,
		side,
		payment_method_used,
		ip
    } = data;
    
	const exchangeInfo = getKitConfig().info;

    if(!P2P_SUPPORTED_PLANS.includes(exchangeInfo.plan)) {
        throw new Error('Service not supported by your exchange plan');
    }

	// Check User tier
	const p2pConfig = getKitConfig()?.p2p_config;

	const p2pDeal = await getModel('p2pDeal').findOne({ where: { id: deal_id } });

	const { max_order_value, min_order_value, spread, price_type } = p2pDeal;
	let { exchange_rate } = p2pDeal;
	const { merchant_id } = p2pDeal;

    if (!p2pDeal) {
        throw new Error('deal does not exist');
    }

	if (!p2pDeal.status) {
		throw new Error('deal is not active');
	}

	const buyer = await getUserByKitId(user_id);
   
    if (!buyer) {
        throw new Error(USER_NOT_FOUND);
    }

	//Check Buyer Tier
	if (p2pConfig.starting_user_tier > buyer.verification_level) {
		throw new Error('Your tier does not support creating P2P transactions');
	}


	if (merchant_id === user_id) {
		throw new Error('Merchant and Buyer cannot be same');
	}

	//Cant have more than 3 active transactions per user
	const userTransactions = await getModel('p2pTransaction').findAll({ where: { 
		...(side === 'buy' ? { merchant_id: buyer.id } : { user_id: buyer.id }), 
		transaction_status: "active" } });

	if (userTransactions.length > 3) {
		throw new Error('You have currently 3 active order, please complete them before creating another one');
	}

	const merchant = await getUserByKitId(p2pDeal.merchant_id);

	const merchantBalance = await getP2PAccountBalance(side === 'buy' ? user_id : merchant_id, p2pDeal.buying_asset);

	if (price_type === 'dynamic') {
		const broker = await getModel('broker').findOne({ type: 'dynamic', symbol:  p2pDeal.dynamic_pair });
		const { formula, increment_size } = broker;

		const result = await testBroker({
			formula,
			increment_size,
			spread: 1
		});

		exchange_rate = result.buy_price;
		
	}
	const price = new BigNumber(exchange_rate).multipliedBy(p2pDeal.side === 'sell' ? (1 + (spread / 100)) : (1 - (spread / 100)));
	const amount_digital_currency = new BigNumber(amount_fiat).dividedBy(price).toNumber();

	const merchantFeeAmount = (new BigNumber(amount_digital_currency).multipliedBy(p2pConfig.merchant_fee))
	.dividedBy(100).toNumber();

	const buyerFeeAmount = (new BigNumber(amount_digital_currency).multipliedBy(p2pConfig.user_fee))
		.dividedBy(100).toNumber();
		

	if (new BigNumber(merchantBalance).comparedTo(new BigNumber(amount_digital_currency + merchantFeeAmount + buyerFeeAmount)) !== 1) {
        throw new Error('Transaction is not possible at the moment');
    }
	
	if (new BigNumber(side === 'sell' ? amount_fiat : amount_digital_currency).comparedTo(new BigNumber(max_order_value)) === 1) {
		throw new Error('input amount cannot be bigger than max allowable order amount');
	}

	if (new BigNumber(side === 'sell' ? amount_fiat : amount_digital_currency).comparedTo(new BigNumber(min_order_value)) === -1) {
		throw new Error('input amount cannot be lower than min allowable order amount');
	}

	//Check the payment method
	const hasMethod = p2pDeal.payment_methods.find(method => method.system_name === payment_method_used.system_name);

	if (!hasMethod && side === 'sell') {
		throw new Error('invalid payment method');
	}

	const coinConfiguration = getKitCoin(p2pDeal.buying_asset);
	const { increment_unit } = coinConfiguration;

	const decimalPoint = new BigNumber(increment_unit).dp();
	const amount = new BigNumber(amount_digital_currency).decimalPlaces(decimalPoint, BigNumber.ROUND_DOWN).toNumber();

	data.user_status = 'pending';
	data.merchant_status = 'pending';
	data.transaction_status = 'active';
	data.transaction_duration = 30;
	data.transaction_id = uuid();
	data.merchant_id = side === 'buy' ? user_id : merchant_id;
	data.user_id = side === 'buy' ? merchant_id :  user_id;
	data.amount_digital_currency = amount;
	data.deal_id = deal_id;
	const lock = await getNodeLib().lockBalance(side === 'buy' ? buyer.network_id : merchant.network_id, p2pDeal.buying_asset, amount_digital_currency + merchantFeeAmount + buyerFeeAmount);
	data.locked_asset_id = lock.id;
	data.price = price.toNumber();

	const firstChatMessage = {
		sender_id: merchant_id,
		receiver_id: user_id,
		message: p2pDeal.auto_response,
		type: 'message',
		created_at: new Date()
	};

	data.messages = [firstChatMessage];

	const transaction = await getModel('p2pTransaction').create(data, {
		fields: [
			'deal_id',
			'transaction_id',
			'locked_asset_id',
			'merchant_id',
			'user_id',
			'amount_digital_currency',
			'amount_fiat',
			'payment_method_used',
			'user_status',
			'merchant_status',
			'cancellation_reason',
			'transaction_expired',
			'transaction_timestamp',
			'merchant_release',
			'transaction_duration',
			'transaction_status',
			'price',
			'messages'
		]
	});

	sendEmail(
		MAILTYPE.P2P_MERCHANT_IN_PROGRESS,
		merchant.email,
		{
			order_id: transaction.id,
			ip
		},
		merchant.settings
	);

	return transaction;
};

const updateP2pTransaction = async (data) => {
	let {
		user_id,
		id,
		user_status,
		merchant_status,
		cancellation_reason,
		ip
	} = data;
		
	const transaction = await getModel('p2pTransaction').findOne({ where: { id } });
	const p2pDeal = await getModel('p2pDeal').findOne({ where: { id: transaction.deal_id } });
	const merchant = await getUserByKitId(transaction.merchant_id);
	const p2pConfig = getKitConfig()?.p2p_config;
	const user = await getUserByKitId(user_id);

	// eslint-disable-next-line no-prototype-builtins
	if (user_id === transaction.merchant_id && data.hasOwnProperty(user_status)) {
		throw new Error('merchant cannot update buyer status');
	}
	// eslint-disable-next-line no-prototype-builtins
	if (user_id === transaction.user_id && data.hasOwnProperty(merchant_status)) {
		throw new Error('buyer cannot update merchant status');
	}

	if (user_id !== transaction.merchant_id && user_id !== transaction.user_id) {
		throw new Error('you cannot update this transaction');
	}

    if (!transaction) {
        throw new Error('transaction does not exist');
    }

	if (transaction.transaction_status === 'expired') {
		throw new Error(`Transaction expired, ${transaction.transaction_duration} minutes passed without any action`);
	}

	if (transaction.user_status === 'pending' && moment() > moment(transaction.created_at).add(transaction.transaction_duration || 30 ,'minutes')) {
		
		if (transaction.transaction_status !== 'expired') {

			const newMessages = [...transaction.messages];

			const chatMessage = {
				sender_id: user_id,
				receiver_id: transaction.merchant_id,
				message: 'ORDER_EXPIRED',
				type: 'notification',
				created_at: new Date()
			};
		
			sendEmail(
				MAILTYPE.P2P_ORDER_EXPIRED,
				user.email,
				{
					order_id: id,
					ip
				},
				user.settings
			);

			sendEmail(
				MAILTYPE.P2P_ORDER_EXPIRED,
				merchant.email,
				{
					order_id: id,
					ip
				},
				merchant.settings
			);

			newMessages.push(chatMessage);

			await transaction.update({ transaction_status: 'expired', messages: newMessages }, {
				fields: [
					'transaction_status',
					'messages'
				]
			});
			
		}
	
		throw new Error(`Transaction expired, ${transaction.transaction_duration} minutes passed without any action`);
	}


	if (transaction.transaction_status !== 'active') {
			throw new Error('Cannot update inactive transaction');
	}
	if (transaction.merchant_status === 'confirmed' && transaction.user_status === 'confirmed') {
		throw new Error('Cannot update complete transaction');
	}

	if (merchant_status === 'confirmed' && transaction.user_status !== 'confirmed') {
		throw new Error('merchant cannot confirm the transaction while buyer not confirmed');
	} 

	if (merchant_status === 'confirmed' && transaction.user_status === 'confirmed') {
		await getNodeLib().unlockBalance(merchant.network_id, transaction.locked_asset_id);

		const merchantFeeAmount = (new BigNumber(transaction.amount_digital_currency).multipliedBy(p2pConfig.merchant_fee))
		.dividedBy(100).toNumber();

		const buyerFeeAmount = (new BigNumber(transaction.amount_digital_currency).multipliedBy(p2pConfig.user_fee))
		.dividedBy(100).toNumber();
		const buyerTotalAmount = new BigNumber(transaction.amount_digital_currency).minus(new BigNumber(buyerFeeAmount)).toNumber();
		await transferAssetByKitIds(transaction.merchant_id, transaction.user_id, p2pDeal.buying_asset, buyerTotalAmount, 'P2P Transaction', false, { category: 'p2p' });
		
		//send the fees to the source account
		if (p2pConfig.source_account !== transaction.merchant_id) {
			const totalFees =  (new BigNumber(merchantFeeAmount).plus(buyerFeeAmount)).toNumber();
			await transferAssetByKitIds(transaction.merchant_id, p2pConfig.source_account, p2pDeal.buying_asset, totalFees, 'P2P Transaction', false, { category: 'p2p' });
		}
		
		data.transaction_status = 'complete';
		data.merchant_release = new Date();
	} 

	if (user_status === 'appeal' || merchant_status === 'appeal') {
		let initiator_id;
		let defendant_id;
		if (user_status === 'appeal') {
			initiator_id = transaction.user_id;
			defendant_id = transaction.merchant_id; 
		} else {
			initiator_id = transaction.merchant_id;
			defendant_id = transaction.user_id;
		}

		await getNodeLib().unlockBalance( merchant.network_id, transaction.locked_asset_id);
		await createP2pDispute({ 
			transaction_id: transaction.id,
			initiator_id,
			defendant_id,
			reason: cancellation_reason || '',
		});
		data.transaction_status = 'appealed';
	}

	if (user_status === 'cancelled' || merchant_status === 'cancelled') {
		await getNodeLib().unlockBalance(merchant.network_id, transaction.locked_asset_id);
		data.transaction_status = 'cancelled';
	}

	const newMessages = [...transaction.messages];
	
	if (user_status === 'confirmed') {
		const chatMessage = {
			sender_id: user_id,
			receiver_id: transaction.merchant_id,
			message: 'BUYER_PAID_ORDER',
			type: 'notification',
			created_at: new Date()
		};
	
		sendEmail(
			MAILTYPE.P2P_BUYER_PAID_ORDER,
			user.email,
			{
				order_id: id,
				ip
			},
			user.settings
		);

		newMessages.push(chatMessage);
	}

	if (user_status === 'cancelled') {
		const chatMessage = {
			sender_id: user_id,
			receiver_id: transaction.merchant_id,
			message: 'BUYER_CANCELLED_ORDER',
			type: 'notification',
			created_at: new Date()
		};

		sendEmail(
			MAILTYPE.P2P_BUYER_CANCELLED_ORDER,
			user.email,
			{
				order_id: id,
				ip
			},
			user.settings
		);
	
		newMessages.push(chatMessage);
	}

	if (user_status === 'appeal') {
		const chatMessage = {
			sender_id: user_id,
			receiver_id: transaction.merchant_id,
			message: 'BUYER_APPEALED_ORDER',
			type: 'notification',
			created_at: new Date()
		};
	
		sendEmail(
			MAILTYPE.P2P_BUYER_APPEALED_ORDER,
			user.email,
			{
				order_id: id,
				ip
			},
			user.settings
		);
		
		newMessages.push(chatMessage);
	}


	if (merchant_status === 'confirmed') {
		const chatMessage = {
			sender_id: transaction.merchant_id,
			receiver_id: transaction.user_id,
			message: 'VENDOR_CONFIRMED_ORDER',
			type: 'notification',
			created_at: new Date()
		};

		sendEmail(
			MAILTYPE.P2P_VENDOR_CONFIRMED_ORDER,
			user.email,
			{
				order_id: id,
				ip
			},
			user.settings
		);
	
		newMessages.push(chatMessage);
	}
	
	if (merchant_status === 'cancelled') {
		const chatMessage = {
			sender_id: transaction.merchant_id,
			receiver_id: transaction.user_id,
			message: 'VENDOR_CANCELLED_ORDER',
			type: 'notification',
			created_at: new Date()
		};

		sendEmail(
			MAILTYPE.P2P_VENDOR_CANCELLED_ORDER,
			user.email,
			{
				order_id: id,
				ip
			},
			user.settings
		);
	
		newMessages.push(chatMessage);
	}

	if (merchant_status === 'appeal') {
		const chatMessage = {
			sender_id: transaction.merchant_id,
			receiver_id: transaction.user_id,
			message: 'VENDOR_APPEALED_ORDER',
			type: 'notification',
			created_at: new Date()
		};

		sendEmail(
			MAILTYPE.P2P_VENDOR_APPEALED_ORDER,
			user.email,
			{
				order_id: id,
				ip
			},
			user.settings
		);
	
		newMessages.push(chatMessage);
	}

	return transaction.update({...data, messages: newMessages}, {
		fields: [
			'user_status',
			'merchant_status',
			'cancellation_reason',
			'transaction_expired',
			'transaction_timestamp',
			'merchant_release',
			'transaction_duration',
			'transaction_status',
			'messages'
		]
	});
};


const createP2pDispute = async (data) => {
		data.status = true;
		return getModel('p2pDispute').create(data, {
			fields: [
				'transaction_id',
				'initiator_id',
				'defendant_id',
				'reason',
				'resolution',
				'status',
			]
		});
};

const updateP2pDispute = async (data) => {
	const p2pDispute = await getModel('p2pDispute').findOne({ where: { id: data.id } });

	if (!p2pDispute) {
		throw new Error('no record found');
	};

	const dispute = await p2pDispute.update(data, {
		fields: [
			'resolution',
			'status'
		]
	});

	if (data.status == false) {
		const transaction = await getModel('p2pTransaction').findOne({ where: { id: dispute.transaction_id } });
		await transaction.update({
			transaction_status: 'closed'
		}, { fields: ['transaction_status']});
	

		const chatMessage = {
			sender_id: transaction.user_id,
			receiver_id: transaction.merchant_id,
			message: 'ORDER_CLOSED',
			type: 'notification',
			created_at: new Date()
		};
	
		const merchant = await getUserByKitId(transaction.merchant_id);
		const user = await getUserByKitId(transaction.user_id);
		
		sendEmail(
			MAILTYPE.P2P_ORDER_CLOSED,
			user.email,
			{
				order_id: transaction.id,
			},
			user.settings
		);

		sendEmail(
			MAILTYPE.P2P_ORDER_CLOSED,
			merchant.email,
			{
				order_id: transaction.id,
			},
			merchant.settings
		);

		const newMessages = [...transaction.messages];
		newMessages.push(chatMessage);
		
		transaction.update({ messages: newMessages }, {
			fields: [
				'messages'		
			]
		});

	}

	return dispute;
};

const createP2pChatMessage = async (data) => {
	const transaction = await getModel('p2pTransaction').findOne({ where: { id: data.transaction_id } });
	if (!transaction) {
		throw new Error ('no transaction found');
	}

	if (data.sender_id !== transaction.merchant_id && data.sender_id !== transaction.user_id) {
		throw new Error('unauthorized');
	}

	if (transaction.transaction_status !== 'active') {
		throw new Error('Cannot message in inactive transaction');
	}

	const chatMessage = {
		sender_id: data.sender_id,
		receiver_id: data.receiver_id,
		message: data.message,
		type: 'message',
		created_at: new Date()
	};

	const newMessages = [...transaction.messages];
	newMessages.push(chatMessage);
	
	// return transaction.update({ messages: fn('array_append', col('messages'), chatMessage) }, {
	// 	fields: [
	// 		'messages'		
	// 	]
	// });

	return transaction.update({ messages: newMessages }, {
		fields: [
			'messages'		
		]
	});
};
 
const updateMerchantProfile = async (data) => {
	const p2pMerchant = await getModel('p2pMerchant').findOne({ id: data.id });

	if(!p2pMerchant) {
		return getModel('p2pMerchant').create(data, {
			fields: [
				'user_id',
				'blocked_users'
			]
		});
	} else {
		p2pMerchant.update(data, {
			fields: [
				'user_id',
				'blocked_users'
			]
		});
	}
};

const createMerchantFeedback = async (data) => {
	const transaction = await getModel('p2pTransaction').findOne({ where: { id: data.transaction_id } });
	
	if (!transaction) {
		throw new Error ('no transaction found');
	}

	if (transaction.user_id !== data.user_id) {
		throw new Error ('unauthorized');
	}	

	const foundFeedback = await getModel('P2pMerchantsFeedback').findOne({ where: { transaction_id: data.transaction_id } });

	if (foundFeedback) {
		throw new Error ('you already made a feedback');
	}

	if (data.rating > 5) {
		throw new Error ('undefined rating');
	}
	
	if (data.rating < 1) {
		throw new Error ('undefined rating');
	}

	data.merchant_id = transaction.merchant_id;
	return getModel('P2pMerchantsFeedback').create(data, {
		fields: [
			'merchant_id',
			'user_id',
			'transaction_id',
			'rating',
			'comment',
		]
	});
};

const fetchP2PFeedbacks = async (opts = {
	transaction_id: null,
	merchant_id: null,
    limit: null,
    page: null,
    order_by: null,
    order: null,
    start_date: null,
    end_date: null,
    format: null
}) => {
    const pagination = paginationQuery(opts.limit, opts.page);
	const ordering = orderingQuery(opts.order_by, opts.order);
	const timeframe = timeframeQuery(opts.start_date, opts.end_date);

	const query = {
		where: {
			created_at: timeframe,
		...(opts.transaction_id && { transaction_id: opts.transaction_id }),
		...(opts.merchant_id && { merchant_id: opts.merchant_id }),
		},
		order: [ordering],
		...(!opts.format && pagination),
		include: [
			{
				model: getModel('user'),
				as: 'user',
				attributes: ['id', 'full_name']
			},
		]
	};

	if (opts.format) {
		return dbQuery.fetchAllRecords('P2pMerchantsFeedback', query)
			.then((data) => {
				if (opts.format && opts.format === 'csv') {
					if (data.data.length === 0) {
						throw new Error(NO_DATA_FOR_CSV);
					}
					const csv = parse(data.data, Object.keys(data.data[0]));
					return csv;
				} else {
					return data;
				}
			});
	} else {
        return dbQuery.findAndCountAllWithRows('P2pMerchantsFeedback', query);
	}
};

const fetchP2PProfile = async (user_id) => {
  
	const P2pTransaction = getModel('p2pTransaction');
	const P2pMerchantsFeedback = getModel('P2pMerchantsFeedback');
	
	// Total Transactions per Merchant
	const totalTransactions = await P2pTransaction.count({
        where: { merchant_id: user_id }
    });

	// Completion Rate of Transactions
    const completedTransactions = await P2pTransaction.count({
        where: {
            merchant_id: user_id,
            transaction_status: 'complete'
        }
    });

    const completionRate =  (completedTransactions / totalTransactions) * 100;

	// Positive Feedback Percentage
	const totalFeedbacks = await P2pMerchantsFeedback.count({
        where: { merchant_id: user_id }
    });
    const positiveFeedbackCount = await P2pMerchantsFeedback.count({
        where: {
            merchant_id: user_id,
            rating: {
                [Op.gte]: 3
            }
        }
    });

	const negativeFeedbackCount = await P2pMerchantsFeedback.count({
        where: {
            merchant_id: user_id,
            rating: {
                [Op.lte]: 2
            }
        }
    });

    const positiveFeedbackRate = (positiveFeedbackCount / totalFeedbacks) * 100;

	return {
		totalTransactions,
		completionRate,
		positiveFeedbackRate,
		positiveFeedbackCount,
		negativeFeedbackCount
	}
};

module.exports = {
	createP2PDeal,
	createP2PTransaction,
	createP2pDispute,
	updateP2pTransaction,
	updateP2pDispute,
	updateMerchantProfile,
	createMerchantFeedback,
	createP2pChatMessage,
	fetchP2PDeals,
	fetchP2PTransactions,
	fetchP2PDisputes,
	updateP2PDeal,
	deleteP2PDeal,
	fetchP2PFeedbacks,
	fetchP2PProfile
};