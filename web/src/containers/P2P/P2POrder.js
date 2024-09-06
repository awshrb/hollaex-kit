import React, { useEffect, useState, useRef } from 'react';
import { withRouter } from 'react-router';
import { connect } from 'react-redux';
import { isMobile } from 'react-device-detect';
import { Button, Input, message, Rate, Tooltip } from 'antd';
import { CheckCircleTwoTone, SendOutlined } from '@ant-design/icons';
import moment from 'moment';

import STRINGS from 'config/localizedStrings';
import withConfig from 'components/ConfigProvider/withConfig';
import classnames from 'classnames';
import BigNumber from 'bignumber.js';
import './_P2P.scss';
import { Coin, Dialog, EditWrapper, Image } from 'components';
import {
	createChatMessage,
	fetchTransactions,
	updateTransaction,
	createFeedback,
	fetchFeedback,
	fetchP2PProfile,
} from './actions/p2pActions';
import { formatToCurrency } from 'utils/currency';
import { getToken } from 'utils/token';
import { WS_URL } from 'config/constants';

const P2POrder = ({
	data,
	onClose,
	coins,
	pairs,
	constants = {},
	icons: ICONS,
	transaction_limits,
	tiers = {},
	setDisplayOrder,
	selectedTransaction,
	setSelectedTransaction,
	user,
	router,
	p2p_config,
	p2p_message,
	p2p_status,
	p2p_transaction_id,
}) => {
	const coin = coins[selectedTransaction.deal.buying_asset];
	const [selectedOrder, setSelectedOrder] = useState(selectedTransaction);
	const [chatMessage, setChatMessage] = useState();
	const [appealReason, setAppealReason] = useState();
	const [feedback, setFeedback] = useState();
	const [rating, setRating] = useState();
	const [appealSide, setAppealSide] = useState();
	const [displayAppealModal, setDisplayAppealModel] = useState(false);
	const [displayFeedbackModal, setDisplayFeedbackModel] = useState(false);
	const [hasFeedback, setHasFeedback] = useState(false);
	const [ws, setWs] = useState();
	// const [ready, setReady] = useState(false);
	const [displayCancelWarning, setDisplayCancelWarning] = useState();
	const [displayConfirmWarning, setDisplayConfirmWarning] = useState();
	const [lastClickTime, setLastClickTime] = useState(0);
	const [displayUserFeedback, setDisplayUserFeedback] = useState(false);
	const [userFeedback, setUserFeedback] = useState([]);
	const [userProfile, setUserProfile] = useState();
	const [selectedProfile, setSelectedProfile] = useState();
	const ref = useRef(null);
	const buttonRef = useRef(null);

	useEffect(() => {
		ref.current.scroll({
			top: 9999,
			behavior: 'smooth',
		});
	}, [selectedOrder.messages]);

	const handleKeyDown = (event) => {
		if (event.key === 'Enter') {
			buttonRef.current.click();
		}
	};

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);

		// Cleanup the event listener on component unmount
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		setSelectedOrder((prevState) => {
			if (
				p2p_message?.id === selectedOrder?.id &&
				p2p_message?.receiver_id === user?.id &&
				(p2p_message?.sender_id === prevState?.merchant_id ||
					p2p_message?.sender_id === prevState?.user_id)
			) {
				const found =
					prevState?.messages?.[prevState?.messages?.length - 1]?.message ===
					p2p_message?.message;
				if (!found) {
					return prevState?.messages.push(p2p_message);
				}
			}
			return { ...prevState, ...{ messages: prevState?.messages } };
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [p2p_message]);

	useEffect(() => {
		if (p2p_transaction_id === selectedOrder?.id) updateP2PStatus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [p2p_status]);

	useEffect(() => {
		fetchFeedback({ transaction_id: selectedOrder?.id })
			.then((res) => {
				if (res?.data?.length > 0) {
					setHasFeedback(true);
				}
			})
			.catch((err) => err);

		if (
			selectedOrder.user_status === 'pending' &&
			moment() >
				moment(selectedOrder?.created_at).add(
					selectedOrder?.transaction_duration || 30,
					'minutes'
				)
		) {
			if (selectedOrder?.transaction_status !== 'expired') {
				updateTransaction({
					id: selectedOrder?.id,
					transaction_status: 'expired',
				})
					.then((res) => {
						setSelectedOrder({
							...selectedOrder,
							transaction_status: 'expired',
						});
					})
					.catch((err) => err);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const url = `${WS_URL}/stream?authorization=Bearer ${getToken()}`;
		const p2pWs = new WebSocket(url);

		p2pWs.onopen = (evt) => {
			setWs(p2pWs);
			// setReady(true);

			setInterval(() => {
				p2pWs.send(
					JSON.stringify({
						op: 'ping',
					})
				);
			}, 55000);
		};

		return () => {
			p2pWs.close();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const updateP2PStatus = () => {
		fetchTransactions({ id: selectedOrder?.id })
			.then((transaction) => {
				if (transaction?.data[0]?.transaction_status === 'complete') {
					setHasFeedback(false);
				}
				setSelectedOrder(transaction?.data[0]);
			})
			.catch((err) => err);
	};
	// const getTransaction = async () => {
	// try {
	// const transaction = await fetchTransactions({
	// id: selectedOrder.id,
	// });
	// setSelectedOrder(transaction.data[0]);
	// } catch (error) {
	// return error;
	// }
	// };

	const addMessage = (message) => {
		ws.send(
			JSON.stringify({
				op: 'p2pChat',
				args: [
					{
						action: 'addMessage',
						data: message,
					},
				],
			})
		);

		setSelectedOrder((prevState) => {
			return {
				...prevState,
				messages: [...(prevState?.messages || []), message],
			};
		});
	};

	const updateStatus = (status) => {
		ws.send(
			JSON.stringify({
				op: 'p2pChat',
				args: [
					{
						action: 'getStatus',
						data: {
							id: selectedOrder?.id,
							status,
							receiver_id:
								user?.id === selectedOrder?.merchant_id
									? selectedOrder?.user_id
									: selectedOrder?.merchant_id,
						},
					},
				],
			})
		);
	};

	const userReceiveAmount = () => {
		const incrementUnit =
			coins?.[selectedOrder?.deal.buying_asset]?.increment_unit;
		const buyerFeeAmount = new BigNumber(selectedOrder?.amount_digital_currency)
			.multipliedBy(p2p_config?.user_fee)
			.dividedBy(100)
			.toNumber();

		const decimalPoint = new BigNumber(incrementUnit).dp();
		const sourceAmount = new BigNumber(
			selectedOrder?.amount_digital_currency - buyerFeeAmount
		)
			.decimalPlaces(decimalPoint)
			.toNumber();
		return sourceAmount;
	};

	const sendChatMessage = async () => {
		const now = Date.now();
		if (now - lastClickTime >= 1000 && chatMessage?.trim()?.length > 0) {
			try {
				await createChatMessage({
					receiver_id:
						user?.id === selectedOrder?.merchant_id
							? selectedOrder?.user_id
							: selectedOrder?.merchant_id,
					message: chatMessage,
					transaction_id: selectedOrder?.id,
				});

				addMessage({
					sender_id: user?.id,
					type: 'message',
					receiver_id:
						user?.id === selectedOrder?.merchant_id
							? selectedOrder?.user_id
							: selectedOrder?.merchant_id,
					message: chatMessage,
					id: selectedOrder?.id,
				});

				setChatMessage();
			} catch (error) {
				message.error(error.data.message);
			}
			setLastClickTime(now);
		}
	};
	const formatAmount = (currency, amount) => {
		const min = coins[currency].min;
		const formattedAmount = formatToCurrency(amount, min);
		return formattedAmount;
	};

	const isOrderCreated =
		selectedOrder?.transaction_status === 'active' &&
		selectedOrder.user_status === 'pending';
	const isOrderVerified =
		selectedOrder.user_status === 'confirmed' &&
		selectedOrder.merchant_status === 'pending';
	const isOrderConfirmed = selectedOrder.merchant_status === 'confirmed';

	return (
		<>
			<Dialog
				className="transaction-appeal-popup-wrapper"
				isOpen={displayAppealModal}
				onCloseDialog={() => {
					setDisplayAppealModel(false);
				}}
			>
				<div className="transaction-appeal-popup-container important-text">
					<div className="transaction-appeal-title">
						<EditWrapper stringId="P2P.APPEAL_TRANSACTION">
							{STRINGS['P2P.APPEAL_TRANSACTION']}
						</EditWrapper>
					</div>
					<div className="appeal-reason-container">
						<div className="appeal-reason-title">
							<EditWrapper stringId="P2P.ENTER_REASON">
								{STRINGS['P2P.ENTER_REASON']}
							</EditWrapper>
						</div>
						<Input
							className="appeal-input-field important-text"
							value={appealReason}
							onChange={(e) => {
								setAppealReason(e.target.value);
							}}
						/>
					</div>
				</div>

				<div className="appeal-reason-button-container">
					<Button
						onClick={() => {
							setDisplayAppealModel(false);
						}}
						className="purpleButtonP2P cancel-btn"
						type="default"
					>
						<EditWrapper stringId="P2P.CANCEL">
							{STRINGS['P2P.CANCEL']}
						</EditWrapper>
					</Button>
					<Button
						onClick={async () => {
							try {
								if (appealSide === 'merchant') {
									await updateTransaction({
										id: selectedOrder?.id,
										merchant_status: 'appeal',
										cancellation_reason: appealReason,
									});
									updateP2PStatus();
									updateStatus('appeal');
									message.success(STRINGS['P2P.APPEALED_TRANSACTION']);
								} else {
									await updateTransaction({
										id: selectedOrder.id,
										user_status: 'appeal',
										cancellation_reason: appealReason,
									});
									updateP2PStatus();
									updateStatus('appeal');
									message.success(STRINGS['P2P.APPEALED_TRANSACTION']);
								}
								setAppealSide();
								setDisplayAppealModel(false);
							} catch (error) {
								message.error(error.data.message);
							}
						}}
						className="purpleButtonP2P okay-btn"
						type="default"
					>
						<EditWrapper stringId="P2P.OKAY">{STRINGS['P2P.OKAY']}</EditWrapper>
					</Button>
				</div>
			</Dialog>

			{displayUserFeedback && (
				<Dialog
					className="display-user-feedback-popup-wrapper"
					isOpen={displayUserFeedback}
					onCloseDialog={() => {
						setDisplayUserFeedback(false);
					}}
				>
					<div className="display-user-feedback-popup-container">
						<div className="user-feedback">
							<div className="profile-title">
								{selectedProfile?.full_name || (
									<EditWrapper stringId="P2P.ANONYMOUS">
										{STRINGS['P2P.ANONYMOUS']}
									</EditWrapper>
								)}
								<span className="ml-2">
									(
									<EditWrapper stringId="P2P.TAB_PROFILE">
										{STRINGS['P2P.TAB_PROFILE']}
									</EditWrapper>
									)
								</span>
							</div>

							<div className="user-feedback-details-container">
								<div className="user-feedback-card-container">
									<div className="user-feedback-card-list">
										<div className="user-feedback-card">
											<div className="total-order-text fs-16">
												<EditWrapper stringId="P2P.TOTAL_ORDERS">
													{STRINGS['P2P.TOTAL_ORDERS']}
												</EditWrapper>
											</div>
											<div className="order-times-text">
												<span>{userProfile?.totalTransactions} </span>
												<span>
													<EditWrapper stringId="P2P.TIMES">
														{STRINGS['P2P.TIMES']}
													</EditWrapper>
												</span>
											</div>
										</div>
										<div className="user-feedback-card">
											<div className="total-order-text fs-16">
												<EditWrapper stringId="P2P.COMPLETION_RATE">
													{STRINGS['P2P.COMPLETION_RATE']}
												</EditWrapper>
											</div>
											<div className="order-times-text">
												{(userProfile?.completionRate || 0).toFixed(2)}%
											</div>
										</div>
										<div className="user-feedback-card">
											<div className="total-order-text fs-16">
												<EditWrapper stringId="P2P.POSITIVE_FEEDBACK">
													{STRINGS['P2P.POSITIVE_FEEDBACK']}
												</EditWrapper>
											</div>
											<div className="order-times-text">
												{(userProfile?.positiveFeedbackRate || 0).toFixed(2)}%
											</div>
											<div className="feedback-count">
												<EditWrapper stringId="P2P.POSITIVE">
													{STRINGS['P2P.POSITIVE']}
												</EditWrapper>
												{userProfile?.positiveFeedbackCount} /
												<EditWrapper stringId="P2P.NEGATIVE">
													{STRINGS['P2P.NEGATIVE']}
												</EditWrapper>
												{userProfile?.negativeFeedbackCount}
											</div>
										</div>
									</div>
								</div>

								<div className="total-feedback-count">
									<span>
										<EditWrapper stringId="P2P.FEEDBACK">
											{STRINGS['P2P.FEEDBACK']}
										</EditWrapper>
									</span>
									<span className="ml-2">({userFeedback?.length || 0})</span>
								</div>
								{userFeedback?.length === 0 ? (
									<div className="no-feedback-container">
										<EditWrapper stringId="P2P.NO_FEEDBACK">
											{STRINGS['P2P.NO_FEEDBACK']}
										</EditWrapper>
									</div>
								) : (
									<table className="feedback-table-container w-100">
										<thead>
											<tr className="table-header-row">
												<th>
													<EditWrapper stringId="P2P.COMMENT">
														{STRINGS['P2P.COMMENT']}
													</EditWrapper>
												</th>
												<th>
													<EditWrapper stringId="P2P.RATING">
														{STRINGS['P2P.RATING']}
													</EditWrapper>
												</th>
											</tr>
										</thead>
										<tbody>
											{userFeedback.map((deal) => {
												return (
													<tr className="table-bottom-row">
														<td className="td-fit">{deal.comment}</td>
														<td className="td-fit">
															<Rate
																disabled
																allowHalf={false}
																autoFocus={false}
																allowClear={false}
																value={deal.rating}
															/>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								)}
							</div>
						</div>
					</div>
				</Dialog>
			)}

			{displayFeedbackModal && (
				<Dialog
					className="feedback-submit-popup-wrapper"
					isOpen={displayFeedbackModal}
					onCloseDialog={() => {
						setDisplayFeedbackModel(false);
					}}
				>
					<div className="feedback-submit-popup-container">
						<div className="submit-feedback-title">
							<EditWrapper stringId="P2P.SUBMIT_FEEDBACK">
								{STRINGS['P2P.SUBMIT_FEEDBACK']}
							</EditWrapper>
						</div>
						<div className="feedback-field-container">
							<div className="feedback-label">
								<EditWrapper stringId="P2P.INPUT_FEEDBACK">
									{STRINGS['P2P.INPUT_FEEDBACK']}
								</EditWrapper>
							</div>
							<Input
								className="feedback-input-field important-text"
								value={feedback}
								onChange={(e) => {
									setFeedback(e.target.value);
								}}
							/>
						</div>
						<div className="select-rating-container">
							<div className="select-rating-title">
								<EditWrapper stringId="P2P.SELECT_RATING">
									{STRINGS['P2P.SELECT_RATING']}
								</EditWrapper>
							</div>
							<Rate
								defaultValue={1}
								onChange={(e) => {
									if (e > 0) setRating(e);
								}}
								value={rating}
							/>
						</div>
					</div>

					<div className="submit-transaction-button-container">
						<Button
							onClick={() => {
								setDisplayFeedbackModel(false);
								setFeedback();
								setRating();
							}}
							className="cancel-btn important-text"
							type="default"
						>
							<EditWrapper stringId="P2P.CANCEL">
								{STRINGS['P2P.CANCEL']}
							</EditWrapper>
						</Button>
						<Button
							onClick={async () => {
								try {
									if (!rating || rating === 0) {
										message.error(STRINGS['P2P.SELECT_RATING']);
									}
									if (!feedback) {
										message.error(STRINGS['P2P.INPUT_FEEDBACK']);
									}
									await createFeedback({
										transaction_id: selectedOrder?.id,
										comment: feedback,
										rating: rating,
									});
									message.success(STRINGS['P2P.FEEDBACK_SUBMITTED']);
									setDisplayFeedbackModel(false);
									setFeedback();
									setRating();
									setHasFeedback(true);
								} catch (error) {
									message.error(error.data.message);
								}
							}}
							className="proceed-btn important-text"
							type="default"
						>
							<EditWrapper stringId="P2P.PROCEED">
								{STRINGS['P2P.PROCEED']}
							</EditWrapper>
						</Button>
					</div>
				</Dialog>
			)}

			{displayCancelWarning && (
				<Dialog
					className="cancel-popup-wrapper feedback-submit-popup-wrapper"
					isOpen={displayCancelWarning}
					onCloseDialog={() => {
						setDisplayCancelWarning(false);
					}}
				>
					<div className="feedback-submit-popup-container">
						<div className="submit-feedback-title">
							<EditWrapper stringId="P2P.CANCEL_WARNING">
								{STRINGS['P2P.CANCEL_WARNING']}
							</EditWrapper>
						</div>
					</div>

					<div className="submit-transaction-button-container">
						<Button
							onClick={() => {
								setDisplayCancelWarning(false);
							}}
							className="cancel-btn important-text"
							type="default"
						>
							<EditWrapper stringId="P2P.NO">{STRINGS['P2P.NO']}</EditWrapper>
						</Button>
						<Button
							onClick={async () => {
								try {
									await updateTransaction({
										id: selectedOrder?.id,
										user_status: 'cancelled',
									});
									updateP2PStatus();
									updateStatus('cancelled');
									message.success(STRINGS['P2P.TRANSACTION_CANCELLED']);
									setDisplayCancelWarning(false);
								} catch (error) {
									message.error(error.data.message);
								}
							}}
							className="proceed-btn important-text"
							type="default"
						>
							<EditWrapper stringId="P2P.PROCEED">
								{STRINGS['P2P.PROCEED']}
							</EditWrapper>
						</Button>
					</div>
				</Dialog>
			)}

			{displayConfirmWarning && (
				<Dialog
					className="confirm-popup-wrapper feedback-submit-popup-wrapper"
					isOpen={displayConfirmWarning}
					onCloseDialog={() => {
						setDisplayConfirmWarning(false);
					}}
				>
					<div className="feedback-submit-popup-container">
						<div className="confirm-title submit-feedback-title">
							<EditWrapper stringId="P2P.CONFIRM_WARNING">
								{STRINGS['P2P.CONFIRM_WARNING']}
							</EditWrapper>
						</div>
					</div>
					<div className="user-receive-amount-detail">
						<span>{userReceiveAmount()}</span>
						<span>{selectedOrder?.deal?.buying_asset?.toUpperCase()} </span>
						<span>
							<EditWrapper stringId="P2P.AMOUNT_RECEIVE">
								{STRINGS['P2P.AMOUNT_RECEIVE']}
							</EditWrapper>
						</span>
					</div>

					<div className="submit-transaction-button-container">
						<Button
							onClick={() => {
								setDisplayConfirmWarning(false);
							}}
							className="cancel-btn important-text"
							type="default"
						>
							<EditWrapper stringId="P2P.NO">{STRINGS['P2P.NO']}</EditWrapper>
						</Button>
						<Button
							onClick={async () => {
								try {
									await updateTransaction({
										id: selectedOrder?.id,
										merchant_status: 'confirmed',
									});
									updateP2PStatus();
									updateStatus('confirmed');
									message.success(STRINGS['P2P.CONFIRMED_TRANSACTION']);
									setDisplayConfirmWarning(false);
								} catch (error) {
									message.error(error.data.message);
								}
							}}
							className="proceed-btn important-text"
							type="default"
						>
							<EditWrapper stringId="P2P.PROCEED">
								{STRINGS['P2P.PROCEED']}
							</EditWrapper>
						</Button>
					</div>
				</Dialog>
			)}

			<div
				className="back-to-orders-link"
				onClick={() => {
					setDisplayOrder(false);
					router.push('/p2p');
				}}
			>
				{'<'}
				<EditWrapper stringId="REFERRAL_LINK.BACK_LOWER">
					{STRINGS['REFERRAL_LINK.BACK_LOWER']}
				</EditWrapper>
				<span className="ml-2 back-to-order-text">
					<EditWrapper stringId="P2P.BACK_TO_ORDERS">
						{STRINGS['P2P.BACK_TO_ORDERS']}
					</EditWrapper>
				</span>
			</div>
			{(isOrderCreated || isOrderVerified || isOrderConfirmed) && (
				<div className="custom-stepper-container">
					<div
						className={
							isOrderCreated
								? 'trade-step-active trade-step-one'
								: 'trade-step-one'
						}
					>
						<div className="check-icon">
							{(isOrderCreated || isOrderVerified || isOrderConfirmed) && (
								<CheckCircleTwoTone />
							)}
						</div>
						<div className="trade-step-container">
							<div className={isOrderCreated && 'important-text'}>
								<EditWrapper stringId="P2P.STEP_1">
									{STRINGS['P2P.STEP_1']}:
								</EditWrapper>
							</div>
							<div className="ml-1">
								<EditWrapper stringId="P2P.P2P_ORDER_CREATED">
									{STRINGS['P2P.P2P_ORDER_CREATED']}
								</EditWrapper>
							</div>
						</div>
					</div>
					<div className="trade-custom-line"></div>
					<div
						className={
							isOrderVerified
								? 'trade-step-active trade-step-two'
								: 'trade-step-two'
						}
					>
						<div className="check-icon">
							{(isOrderVerified || isOrderConfirmed) && <CheckCircleTwoTone />}
						</div>
						<div className="trade-step-container">
							<div className={isOrderVerified && 'important-text'}>
								<EditWrapper stringId="P2P.STEP_2">
									{STRINGS['P2P.STEP_2']}:
								</EditWrapper>
							</div>
							<div className="ml-1">
								<EditWrapper stringId="P2P.VENDOR_CHECKS_TITLE">
									{STRINGS['P2P.VENDOR_CHECKS_TITLE']}
								</EditWrapper>
							</div>
						</div>
					</div>

					<div className="trade-custom-line"></div>
					<div
						className={
							isOrderConfirmed
								? 'trade-step-active trade-step-three'
								: 'trade-step-three'
						}
					>
						<div className="check-icon">
							{isOrderConfirmed && <CheckCircleTwoTone />}
						</div>
						<div className="trade-step-container">
							<div className={isOrderConfirmed && 'important-text'}>
								<EditWrapper stringId="P2P.STEP_3">
									{STRINGS['P2P.STEP_3']}:
								</EditWrapper>
							</div>
							<div className="ml-1">
								<EditWrapper stringId="P2P.FUND_RELEASED">
									{STRINGS['P2P.FUND_RELEASED']}
								</EditWrapper>
							</div>
						</div>
					</div>
				</div>
			)}
			{/* <div className='order-expiry-limit-container'>
				<div className='time-remaining-container'>
					<div className='important-text'>
						<EditWrapper stringId="P2P.ORDER_EXPIRY">
							{STRINGS['P2P.ORDER_EXPIRY']}
						</EditWrapper>
					</div>
					<span>30 Minutes</span>
				</div>
				<div className='order-details-container'>
					<div>
						<EditWrapper stringId="P2P.TRANSACTION_ID">
							{STRINGS['P2P.TRANSACTION_ID']}
						</EditWrapper>
					</div>
					<span className='important-text'>{selectedOrder.transaction_id}</span>
				</div>
			</div> */}
			<div
				className={classnames(
					...['P2pOrder p2p-order-wrapper', isMobile ? 'mobile-view-p2p' : '']
				)}
			>
				<div className="wallet-assets_block p2p-order-container">
					<div className="p2p-order-details-container w-50">
						<div className="trade-assets-container">
							<Coin iconId={coin?.icon_id} type="CS10" />
							<div>
								<div className="order-title">
									<EditWrapper stringId="P2P.ORDER">
										{STRINGS['P2P.ORDER']}
									</EditWrapper>
								</div>
								<div className="asset-name">
									{user?.id === selectedOrder?.merchant_id ? (
										<EditWrapper stringId="P2P.SELL_COIN">
											{STRINGS['P2P.SELL_COIN']}
										</EditWrapper>
									) : (
										<EditWrapper stringId="P2P.BUY_COIN">
											{STRINGS['P2P.BUY_COIN']}
										</EditWrapper>
									)}{' '}
									{coin?.fullname} ({coin?.symbol?.toUpperCase()})
								</div>
							</div>
						</div>
						{/* <div className='transaction-container'>
							<div>
								<EditWrapper stringId="P2P.TRANSACTION_ID">
									{STRINGS['P2P.TRANSACTION_ID']}
								</EditWrapper>
							</div>
							<span className='important-text'>{selectedOrder.transaction_id}</span>
						</div> */}
						<div className="release-amount-container">
							<div
								className={
									user?.id === selectedOrder?.user_id && 'release-amount-title'
								}
							>
								<EditWrapper stringId="P2P.AMOUNT_TO">
									{STRINGS['P2P.AMOUNT_TO']}
								</EditWrapper>{' '}
								<span>
									{user?.id === selectedOrder?.merchant_id
										? STRINGS['P2P.RELEASE']
										: STRINGS['P2P.SEND_UPPER']}
								</span>
								:
							</div>
							<div className="trading-amount-container">
								{user?.id === selectedOrder?.merchant_id && (
									<div className="amount-field">
										<span className="important-text">
											{userReceiveAmount()}
										</span>
										<span className="important-text">
											{selectedOrder?.deal?.buying_asset?.toUpperCase()}
										</span>
										<Coin
											iconId={coins[selectedOrder?.deal?.buying_asset].icon_id}
											type="CS4"
										/>
									</div>
								)}
								{user?.id === selectedOrder?.user_id && (
									<div className="amount-field">
										<span className="receive-amount important-text">
											{selectedOrder?.amount_fiat}
										</span>
										<span className="trading-asset important-text">
											{selectedOrder?.deal?.spending_asset?.toUpperCase()}
										</span>
										<Coin
											iconId={
												coins[selectedOrder?.deal?.spending_asset].icon_id
											}
											type="CS4"
										/>
									</div>
								)}
								<div>
									{user?.id === selectedOrder?.merchant_id ? (
										<EditWrapper stringId="P2P.AMOUNT_SEND_RELEASE">
											{STRINGS['P2P.AMOUNT_SEND_RELEASE']}
										</EditWrapper>
									) : (
										<EditWrapper stringId="P2P.REQUIRED_FLAT_TRANSFER_AMOUNT">
											{STRINGS['P2P.REQUIRED_FLAT_TRANSFER_AMOUNT']}
										</EditWrapper>
									)}
								</div>
							</div>
						</div>
						<div className="asset-price-container">
							<div className="price-title">
								<EditWrapper stringId="P2P.PRICE">
									{STRINGS['P2P.PRICE']}
								</EditWrapper>
								:
							</div>
							<div className="trading-amount-container">
								<div className="amount-field">
									<span className="important-text">
										{formatAmount(
											selectedOrder?.deal?.spending_asset,
											selectedOrder?.price
										)}
									</span>
									<span className="important-text">
										{selectedOrder?.deal?.spending_asset?.toUpperCase()}
									</span>
									<Coin
										iconId={coins[selectedOrder?.deal?.spending_asset]?.icon_id}
										type="CS4"
									/>
								</div>
								<div className="amount-field">
									<span>
										<EditWrapper stringId="P2P.PER_COIN">
											{STRINGS['P2P.PER_COIN']}
										</EditWrapper>{' '}
									</span>
									<span>
										{selectedOrder?.deal?.buying_asset?.toUpperCase()}
									</span>
									<Coin
										iconId={coins[selectedOrder?.deal?.buying_asset]?.icon_id}
										type="CS4"
									/>
								</div>
							</div>
						</div>
						<div className="receive-amount-container">
							<div
								className={
									user?.id === selectedOrder?.merchant_id
										? 'receive-amount-title important-text font-weight-bold'
										: 'receive-amount-title'
								}
							>
								<EditWrapper stringId="P2P.RECEIVING_AMOUNT">
									{STRINGS['P2P.RECEIVING_AMOUNT']}
								</EditWrapper>
								:
							</div>
							{user?.id === selectedOrder?.merchant_id && (
								<div className="trading-amount-container">
									<div className="amount-field">
										<span className="receive-amount important-text font-weight-bold">
											{selectedOrder?.amount_fiat}
										</span>
										<span className="important-text">
											{selectedOrder?.deal?.spending_asset?.toUpperCase()}
										</span>
										<Coin
											iconId={
												coins[selectedOrder?.deal?.spending_asset]?.icon_id
											}
											type="CS4"
										/>
									</div>
									<div className="amount-field">
										<span>
											{selectedOrder?.deal?.spending_asset?.toUpperCase()}
										</span>
										<span>
											<EditWrapper stringId="P2P.SPENDING_AMOUNT">
												{STRINGS['P2P.SPENDING_AMOUNT']}
											</EditWrapper>
										</span>
									</div>
								</div>
							)}

							{user?.id === selectedOrder?.user_id && (
								<div className="trading-amount-container">
									<div className="amount-field">
										<span className="important-text">
											{userReceiveAmount()}
										</span>
										<span className="important-text">
											{selectedOrder?.deal?.buying_asset?.toUpperCase()}
										</span>
										<Coin
											iconId={coins[selectedOrder?.deal?.buying_asset]?.icon_id}
											type="CS4"
										/>
									</div>
									<div className="amount-field">
										<span>
											{selectedOrder?.deal?.buying_asset?.toUpperCase()}
										</span>
										<span>
											<EditWrapper stringId="P2P.BUYING_AMOUNT">
												{STRINGS['P2P.BUYING_AMOUNT']}
											</EditWrapper>
										</span>
									</div>
								</div>
							)}
						</div>
						<div className="trading-fee-container">
							<div>
								<EditWrapper stringId="P2P.FEE">
									{STRINGS['P2P.FEE']}
								</EditWrapper>
								:
							</div>
							{user?.id === selectedOrder?.merchant_id && (
								<div className="important-text">
									<div>{p2p_config?.merchant_fee}%</div>
								</div>
							)}

							{user?.id === selectedOrder?.user_id && (
								<div className="important-text">
									<div>{p2p_config?.user_fee}%</div>
								</div>
							)}
						</div>
						<div className="amount-transfer-container">
							<div className="transfer-title">
								<EditWrapper stringId="P2P.TRANSFER_DETAILS">
									{STRINGS['P2P.TRANSFER_DETAILS']}
								</EditWrapper>
							</div>
							{user?.id === selectedOrder?.user_id && (
								<div className="my-2 secondary-text">
									<EditWrapper stringId="P2P.PAYMENT_INSTRUCTIONS">
										{STRINGS['P2P.PAYMENT_INSTRUCTIONS']}
									</EditWrapper>
								</div>
							)}

							{user?.id === selectedOrder?.merchant_id && (
								<div className="my-2 secondary-text">
									<EditWrapper stringId="P2P.PAYMENT_ACCOUNT">
										{STRINGS['P2P.PAYMENT_ACCOUNT']}
									</EditWrapper>
								</div>
							)}

							<div
								className={
									user?.id === selectedOrder.merchant_id
										? 'payment-details active-sell'
										: 'payment-details active-buy'
								}
							>
								<div className="payment-methods-list">
									<div className="font-weight-bold">
										<EditWrapper stringId="P2P.PAYMENT_METHOD">
											{STRINGS['P2P.PAYMENT_METHOD']}
										</EditWrapper>
										:
									</div>
									<div>{selectedOrder?.payment_method_used?.system_name}</div>
								</div>

								{selectedOrder?.payment_method_used?.fields?.map((x) => {
									return (
										<div className="payment-methods-list">
											<div className="font-weight-bold">{x?.name}:</div>
											<div>{x?.value}</div>
										</div>
									);
								})}
							</div>
						</div>

						<div className="order-verification-container secondary-text">
							{/* <div className='mb-3 important-text'>
								<EditWrapper stringId="P2P.EXPECTED_TIME">
									{STRINGS['P2P.EXPECTED_TIME']}
								</EditWrapper>
							</div> */}

							{user?.id === selectedOrder?.user_id && (
								<>
									{selectedOrder?.user_status === 'pending' && (
										<>
											<div className="mb-3">
												<EditWrapper stringId="P2P.PAYMENT_TIME">
													{STRINGS['P2P.PAYMENT_TIME']}
												</EditWrapper>
											</div>
											<div className="mb-3">
												<EditWrapper stringId="P2P.ORDER_CANCELLED">
													{STRINGS['P2P.ORDER_CANCELLED']}
												</EditWrapper>
											</div>
										</>
									)}

									{selectedOrder?.user_status === 'confirmed' && (
										<div className="mb-3">
											<EditWrapper stringId="P2P.FUNDS_CREDITED">
												{STRINGS['P2P.FUNDS_CREDITED']}
											</EditWrapper>
										</div>
									)}

									{selectedOrder?.merchant_status === 'cancelled' && (
										<div className="mb-3">
											<EditWrapper stringId="P2P.VENDOR_CANCELLED">
												{STRINGS['P2P.VENDOR_CANCELLED']}
											</EditWrapper>
										</div>
									)}

									{selectedOrder?.merchant_status === 'confirmed' && (
										<div className="mb-3 order-confirmed-container">
											<div className="d-flex">
												<span className="check-icon">
													<CheckCircleTwoTone />
												</span>
												<div className="order-complete-title ml-1">
													<EditWrapper stringId="P2P.ORDER_COMPLETE">
														{STRINGS['P2P.ORDER_COMPLETE']}
													</EditWrapper>
												</div>
											</div>
											<div className="mt-2">
												<EditWrapper stringId="P2P.FUNDS_TRANSFERRED">
													{STRINGS['P2P.FUNDS_TRANSFERRED']}
												</EditWrapper>
											</div>
											<div
												className="go-to-deposit-link blue-link"
												onClick={() => {
													router.replace('/transactions?tab=deposits');
												}}
											>
												<EditWrapper stringId="P2P.GO_DEPOSIT">
													<span className="fs-12">
														{STRINGS['P2P.GO_DEPOSIT']}
													</span>
												</EditWrapper>
											</div>
											{!hasFeedback && (
												<Button
													className="feedback-submit-btn mt-3"
													onClick={() => {
														setDisplayFeedbackModel(true);
													}}
													ghost
												>
													<EditWrapper stringId="P2P.SUBMIT_FEEDBACK">
														{STRINGS['P2P.SUBMIT_FEEDBACK']}
													</EditWrapper>
												</Button>
											)}
										</div>
									)}
									{selectedOrder?.merchant_status === 'appeal' && (
										<>
											<div className="vendor-appealed-text">
												<EditWrapper stringId="P2P.VENDOR_APPEALED">
													{STRINGS['P2P.VENDOR_APPEALED']}
												</EditWrapper>
											</div>
										</>
									)}
									{selectedOrder?.user_status === 'appeal' && (
										<>
											<div className="user-appealed-text">
												<EditWrapper stringId="P2P.USER_APPEALED">
													{STRINGS['P2P.USER_APPEALED']}
												</EditWrapper>
											</div>
										</>
									)}
								</>
							)}

							{user?.id === selectedOrder?.merchant_id && (
								<>
									{selectedOrder.merchant_status === 'confirmed' && (
										<div className="mb-3 order-confirmed-container">
											<div className="d-flex">
												<span className="check-icon">
													<CheckCircleTwoTone />
												</span>
												<div className="order-complete-title ml-1">
													<EditWrapper stringId="P2P.ORDER_COMPLETE">
														{STRINGS['P2P.ORDER_COMPLETE']}
													</EditWrapper>
												</div>
											</div>
											<div className="mt-2">
												<EditWrapper stringId="P2P.ORDER_COMPLETE_VENDOR">
													{STRINGS['P2P.ORDER_COMPLETE_VENDOR']}
												</EditWrapper>
											</div>
											<div
												className="go-to-withdraw-link blue-link"
												onClick={() => {
													router.replace('/transactions?tab=withdrawals');
												}}
											>
												<EditWrapper stringId="P2P.GO_WITHDRAWALS">
													<span className="fs-12">
														{STRINGS['P2P.GO_WITHDRAWALS']}
													</span>
												</EditWrapper>
											</div>
										</div>
									)}

									{selectedOrder?.user_status === 'pending' && (
										<>
											<div className="mt-2 mb-2">
												<EditWrapper stringId="P2P.PAYMENT_NOT_SENT">
													{STRINGS['P2P.PAYMENT_NOT_SENT']}
												</EditWrapper>
											</div>
											<div className="mb-2">
												<EditWrapper stringId="P2P.CONFIRM_AND_RELEASE">
													{STRINGS['P2P.CONFIRM_AND_RELEASE']}
												</EditWrapper>
											</div>
										</>
									)}
									{selectedOrder?.user_status === 'cancelled' && (
										<div className="mt-2 mb-2">
											<EditWrapper stringId="P2P.TRANSACTION_CANCELLED">
												{STRINGS['P2P.TRANSACTION_CANCELLED']}
											</EditWrapper>
										</div>
									)}
									{selectedOrder?.user_status === 'confirmed' &&
										selectedOrder?.merchant_status !== 'confirmed' && (
											<>
												<div className="mt-2">
													<EditWrapper stringId="P2P.BUYER_CONFIRMED">
														{STRINGS['P2P.BUYER_CONFIRMED']}
													</EditWrapper>
												</div>
												<div className="mt-1 mb-3">
													<EditWrapper stringId="P2P.CHECK_AND_RELEASE">
														{STRINGS['P2P.CHECK_AND_RELEASE']}
													</EditWrapper>
												</div>
											</>
										)}
									{user?.id === selectedOrder?.user_id &&
										selectedOrder.user_status === 'appeal' && (
											<div className="mt-2 mb-2">
												<EditWrapper stringId="P2P.USER_APPEALED">
													{STRINGS['P2P.USER_APPEALED']}
												</EditWrapper>
											</div>
										)}

									{user?.id === selectedOrder?.merchant_id &&
										selectedOrder.user_status === 'appeal' && (
											<div className="mt-2 mb-2">
												<EditWrapper stringId="P2P.BUYER_APPEALED_ORDER">
													{STRINGS['P2P.BUYER_APPEALED_ORDER']}
												</EditWrapper>
											</div>
										)}
								</>
							)}

							<div className="order-cancel-container">
								{user?.id === selectedOrder?.user_id && (
									<>
										{selectedOrder?.user_status === 'confirmed' &&
											selectedOrder?.merchant_status === 'pending' && (
												<>
													<div
														className="blue-link mt-1"
														onClick={async () => {
															try {
																setDisplayAppealModel(true);
																setAppealSide('user');
															} catch (error) {
																message.error(error.data.message);
															}
														}}
													>
														<EditWrapper stringId="P2P.APPEAL">
															<span className="text-decoration-underline appeal-link">
																{STRINGS['P2P.APPEAL']}
															</span>
														</EditWrapper>
													</div>
													<div
														className="important-text mt-1"
														onClick={async () => {
															setDisplayCancelWarning(true);
														}}
													>
														<span className="cancel-link">
															<EditWrapper stringId="P2P.CANCEL_ORDER">
																<span className="text-decoration-underline">
																	{STRINGS['P2P.CANCEL_ORDER']}
																</span>
															</EditWrapper>
														</span>
													</div>
												</>
											)}
									</>
								)}

								{user?.id === selectedOrder?.merchant_id &&
									selectedOrder?.merchant_status === 'pending' && (
										<span
											className={
												selectedOrder?.user_status !== 'confirmed'
													? 'appeal-confirm-button-container appeal-confirm-button-container-active'
													: 'appeal-confirm-button-container-active'
											}
										>
											<div
												onClick={async () => {
													try {
														setDisplayAppealModel(true);
														setAppealSide('merchant');
													} catch (error) {
														message.error(error.data.message);
													}
												}}
												className="appeal-link blue-link"
											>
												<EditWrapper stringId="P2P.APPEAL">
													{STRINGS['P2P.APPEAL']}
												</EditWrapper>
											</div>

											<Tooltip
												placement="rightBottom"
												title={
													selectedOrder?.user_status !== 'confirmed'
														? STRINGS['P2P.BUYER_NOT_MADE_THE_PAYMENT']
														: ''
												}
											>
												<Button
													disabled={selectedOrder?.user_status !== 'confirmed'}
													className="purpleButtonP2P"
													onClick={async () => {
														try {
															setDisplayConfirmWarning(true);
														} catch (error) {
															message.error(error.data.message);
														}
													}}
												>
													<EditWrapper stringId="P2P.CONFIRM_AND_RELEASE_CRYPTO">
														{STRINGS['P2P.CONFIRM_AND_RELEASE_CRYPTO']}
													</EditWrapper>
												</Button>
											</Tooltip>
										</span>
									)}
								{user?.id === selectedOrder?.merchant_id &&
									selectedOrder?.merchant_status === 'appeal' && (
										<div className="user-appeal-description font-weight-bold">
											<EditWrapper stringId="P2P.USER_APPEALED">
												{STRINGS['P2P.USER_APPEALED']}
											</EditWrapper>
										</div>
									)}
							</div>
						</div>
					</div>
					<div className="user-chat-container w-50">
						<div className="chat-title">
							<Image
								iconId={'CHAT_P2P_ICON'}
								icon={ICONS['CHAT_P2P_ICON']}
								alt={'text'}
								wrapperClassName="margin-aligner"
							/>
							{user?.id === selectedOrder?.merchant_id ? (
								<EditWrapper stringId="P2P.CHAT_WITH_USER">
									{STRINGS['P2P.CHAT_WITH_USER']}
								</EditWrapper>
							) : (
								<EditWrapper stringId="P2P.CHAT_WITH_VENDOR">
									{STRINGS['P2P.CHAT_WITH_VENDOR']}
								</EditWrapper>
							)}
						</div>
						<div className="chat-field">
							<div
								className="vendor-name-field"
								onClick={async () => {
									try {
										if (user?.id === selectedOrder?.merchant_id) return;
										setSelectedProfile(selectedOrder?.merchant);
										const feedbacks = await fetchFeedback({
											merchant_id: selectedOrder?.merchant_id,
										});
										const profile = await fetchP2PProfile({
											user_id: selectedOrder?.merchant_id,
										});
										setUserFeedback(feedbacks?.data);
										setUserProfile(profile);
										setDisplayUserFeedback(true);
									} catch (error) {
										return error;
									}
								}}
							>
								{user?.id === selectedOrder?.merchant_id ? (
									<div className="font-weight-bold">
										<EditWrapper stringId="P2P.USER_NAME">
											{STRINGS['P2P.USER_NAME']}
										</EditWrapper>
									</div>
								) : (
									<div className="font-weight-bold">
										<EditWrapper stringId="P2P.VENDOR_NAME">
											{STRINGS['P2P.VENDOR_NAME']}
										</EditWrapper>
									</div>
								)}
								{user?.id === selectedOrder?.merchant_id
									? (
											<span className="secondary-text ml-2">
												{selectedOrder?.buyer?.full_name}
											</span>
									  ) || (
											<div className="secondary-text ml-2">
												<EditWrapper stringId="P2P.ANONYMOUS">
													{STRINGS['P2P.ANONYMOUS']}
												</EditWrapper>
											</div>
									  )
									: (
											<span className="secondary-text ml-2">
												{selectedOrder?.merchant?.full_name}{' '}
											</span>
									  ) || (
											<div className="secondary-text ml-2">
												<EditWrapper stringId="P2P.ANONYMOUS">
													{STRINGS['P2P.ANONYMOUS']}
												</EditWrapper>
											</div>
									  )}
							</div>
							<div className="chat-details-container secondary-text">
								{user?.id === selectedOrder?.user_id && (
									<div className="d-flex flex-column">
										<div>
											<EditWrapper stringId="P2P.ORDER_INITIATED">
												{STRINGS['P2P.ORDER_INITIATED']}
											</EditWrapper>
											<span className="ml-2">
												{selectedOrder?.merchant?.full_name || (
													<EditWrapper stringId="P2P.ANONYMOUS">
														{STRINGS['P2P.ANONYMOUS']}
													</EditWrapper>
												)}
											</span>
										</div>
										<span className="message-time">
											(
											{moment(selectedOrder?.created_at).format(
												'DD/MMM/YYYY, hh:mmA'
											)}
											)
										</span>
									</div>
								)}

								{user?.id === selectedOrder?.user_id && (
									<div>
										<EditWrapper stringId="P2P.CONFIRM_PAYMENT">
											{STRINGS['P2P.CONFIRM_PAYMENT']}
										</EditWrapper>
									</div>
								)}

								{user?.id === selectedOrder?.merchant_id && (
									<div className="d-flex flex-column">
										<div>
											<EditWrapper stringId="P2P.ORDER_INITIATED_VENDOR">
												{STRINGS['P2P.ORDER_INITIATED_VENDOR']}
											</EditWrapper>
											<span className="ml-2">
												{selectedOrder?.buyer?.full_name || (
													<EditWrapper stringId="P2P.ANONYMOUS">
														{STRINGS['P2P.ANONYMOUS']}
													</EditWrapper>
												)}
											</span>
										</div>
										<span className="message-time">
											(
											{moment(selectedOrder?.created_at)?.format(
												'DD/MMM/YYYY, hh:mmA'
											)}
											)
										</span>
									</div>
								)}
								{user?.id === selectedOrder?.merchant_id && (
									<div>
										<EditWrapper stringId="P2P.CONFIRM_PAYMENT_VENDOR">
											{STRINGS['P2P.CONFIRM_PAYMENT_VENDOR']}
										</EditWrapper>
									</div>
								)}
							</div>

							<div ref={ref} className="chat-area">
								<div className="chat-message-container">
									{selectedOrder?.messages?.map((message, index) => {
										if (index === 0) {
											return (
												<div className="initial-message">
													<div>
														{message.sender_id === selectedOrder?.merchant_id
															? selectedOrder?.merchant?.full_name
															: selectedOrder?.buyer?.full_name}
														:
													</div>
													<div>{message.message}</div>
													<div className="message-time">
														(
														{moment(message?.created_at || new Date()).format(
															'DD/MMM/YYYY, hh:mmA '
														)}
														)
													</div>
												</div>
											);
										} else {
											if (message.type === 'notification') {
												return (
													<div className="notification-message d-flex flex-column text-center secondary-text my-3">
														{message.message === 'BUYER_PAID_ORDER' &&
														user?.id === selectedOrder?.user_id ? (
															<EditWrapper stringId={`P2P.BUYER_SENT_FUNDS`}>
																{STRINGS[`P2P.BUYER_SENT_FUNDS`]}
															</EditWrapper>
														) : (
															<EditWrapper stringId={`P2P.${message?.message}`}>
																{STRINGS[`P2P.${message?.message}`]}
															</EditWrapper>
														)}
														<span className="message-time">
															(
															{moment(
																message?.created_at || new Date()
															)?.format('DD/MMM/YYYY, hh:mmA ')}
															)
														</span>
													</div>
												);
											} else {
												if (message?.sender_id === user?.id) {
													return (
														<div className="user-message-wrapper">
															<div className="user-message-container">
																<span className="user-name">
																	<EditWrapper stringId="P2P.YOU">
																		<span>{STRINGS['P2P.YOU']}:</span>
																	</EditWrapper>
																</span>
																<span className="user-message ml-2">
																	{message?.message}
																</span>
																<div className="message-time secondary-text">
																	(
																	{moment(
																		message?.created_at || new Date()
																	).format('DD/MMM/YYYY, hh:mmA ')}
																	)
																</div>
															</div>
														</div>
													);
												} else {
													return (
														<div className="merchant-message-wrapper">
															<div className="merchant-message-container">
																<div className="merchant-detail">
																	<div className="important-text">
																		{message?.receiver_id ===
																		selectedOrder?.merchant_id
																			? STRINGS['P2P.BUYER']
																			: selectedOrder?.merchant?.full_name}
																		:
																	</div>
																	<div className="merchant-message">
																		{message?.message}
																	</div>
																</div>
																<div className="message-time secondary-text">
																	(
																	{moment(
																		message?.created_at || new Date()
																	)?.format('DD/MMM/YYYY, hh:mmA ')}
																	)
																</div>
															</div>
														</div>
													);
												}
											}
										}
									})}
								</div>
							</div>

							<div
								className={
									selectedOrder?.transaction_status === 'complete'
										? 'disable-field active-field'
										: 'active-field'
								}
							>
								<div className="message-input-field w-100 mt-3">
									<Input
										value={chatMessage}
										disabled={selectedOrder.transaction_status !== 'active'}
										className={
											selectedOrder.transaction_status !== 'active'
												? 'greyButtonP2P'
												: ''
										}
										onChange={(e) => {
											setChatMessage(e.target.value);
										}}
										suffix={
											<div
												className={
													selectedOrder?.transaction_status !== 'active'
														? 'disabled-btn send-btn blue-link '
														: 'send-btn blue-link'
												}
												ref={buttonRef}
												onClick={
													selectedOrder?.transaction_status === 'active' &&
													sendChatMessage
												}
											>
												<EditWrapper stringId="P2P.SEND_UPPER">
													{STRINGS['P2P.SEND_UPPER']}
												</EditWrapper>
												<SendOutlined />
											</div>
										}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{user?.id === selectedOrder?.user_id &&
				selectedOrder?.transaction_status === 'active' &&
				selectedOrder?.user_status === 'pending' && (
					<div className="confirm-notify-button-container">
						<Button
							className="cancel-btn important-text"
							onClick={async () => {
								try {
									setDisplayCancelWarning(true);
								} catch (error) {
									message.error(error.data.message);
								}
							}}
						>
							<EditWrapper stringId="P2P.CANCEL">
								{STRINGS['P2P.CANCEL']}
							</EditWrapper>
						</Button>
						<Button
							className="confirm-btn important-text"
							onClick={async () => {
								try {
									await updateTransaction({
										id: selectedOrder?.id,
										user_status: 'confirmed',
									});
									updateP2PStatus();
									updateStatus('confirmed');
									message.success(STRINGS['P2P.CONFIRMED_TRANSACTION']);
								} catch (error) {
									message.error(error.data.message);
								}
							}}
						>
							<EditWrapper stringId="P2P.CONFIRM_TRANSFER">
								{STRINGS['P2P.CONFIRM_TRANSFER']}
							</EditWrapper>
						</Button>
					</div>
				)}
		</>
	);
};

const mapStateToProps = (state) => ({
	pairs: state.app.pairs,
	coins: state.app.coins,
	constants: state.app.constants,
	transaction_limits: state.app.transaction_limits,
	p2p_message: state.p2p.chat,
	p2p_status: state.p2p.status,
	p2p_transaction_id: state.p2p.transaction_id,
	user: state.user,
	p2p_config: state.app.constants.p2p_config,
});

export default connect(mapStateToProps)(withRouter(withConfig(P2POrder)));
