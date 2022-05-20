import React, { Component } from 'react';
import { connect } from 'react-redux';
import classnames from 'classnames';
import { reduxForm, SubmissionError } from 'redux-form';
import renderFields from 'components/Form/factoryFields';
import { EditWrapper, Button, IconTitle, HeaderSection, Tab } from 'components';
import STRINGS from 'config/localizedStrings';
import { verifyUserPayment } from 'actions/verificationActions';
import { getErrorLocalized } from 'utils/errors';
import { generateUserPaymentFormFields } from './utils';
import { generateDynamicIconKey, generateDynamicStringKey } from 'utils/id';
import withConfig from 'components/ConfigProvider/withConfig';

const FORM_NAME = 'UserPaymentVerification';

class UserPaymentVerification extends Component {
	constructor(props) {
		super(props);
		const { user_payment } = this.props;
		const tabs = this.getTabs(user_payment);

		this.state = {
			formFields: {},
			tabs,
			activeTab: undefined,
		};
	}

	UNSAFE_componentWillUpdate(_, nextState) {
		const { activeTab } = this.state;
		if (activeTab !== nextState.activeTab) {
			this.generateFormFields(nextState.activeTab);
		}
	}

	getTabs = (user_payment) => {
		const { icons: ICONS } = this.props;
		const tabs = {};
		Object.keys(user_payment).forEach((key) => {
			const iconId = generateDynamicIconKey(
				'ultimate_fiat',
				key,
				'tab'
			)('title');
			const stringId = generateDynamicStringKey(
				'ultimate_fiat',
				key,
				'tab'
			)('title');
			const defaultText = key.replace(/_/g, ' ');

			tabs[key] = {
				icon: ICONS[iconId] || ICONS['VERIFICATION_BANK_NEW'],
				iconId,
				stringId,
				title: STRINGS[stringId] || defaultText,
			};
		});

		return tabs;
	};

	generateFormFields = (tab) => {
		const { user_payment } = this.props;
		const formFields = generateUserPaymentFormFields(user_payment[tab], tab);

		this.setState({ formFields });
	};

	handleSubmit = ({ ...rest }) => {
		const { activeTab: type } = this.state;
		return verifyUserPayment({ ...rest, type })
			.then(({ data }) => {
				this.props.moveToNextStep('user_payment', {
					bank_data: data,
				});
				this.props.setActivePageContent('email');
			})
			.catch((err) => {
				const error = { _error: err.message };
				if (err.response && err.response.data) {
					error._error = err.response.data.message;
				}
				throw new SubmissionError(error);
			});
	};

	onGoBack = () => {
		this.props.setActivePageContent('email');
		this.props.handleBack('user_payment');
	};

	setActiveTab = (activeTab) => {
		this.setState({ activeTab });
	};

	renderTabs = () => {
		const { tabs, activeTab } = this.state;
		const { setActiveTab } = this;
		return (
			<div
				className={classnames(
					'custom-tab-wrapper d-flex flex-nowrap flex-row justify-content-start'
				)}
			>
				{Object.entries(tabs).map(([key, data]) => {
					const tabProps = {
						key: `tab_item-${key}`,
						className: classnames('tab_item', 'f-1', {
							'tab_item-active': key === activeTab,
							pointer: setActiveTab,
						}),
					};
					if (setActiveTab) {
						tabProps.onClick = () => setActiveTab(key);
					}

					return (
						<div {...tabProps}>
							<Tab {...data} />
						</div>
					);
				})}
			</div>
		);
	};

	render() {
		const {
			handleSubmit,
			pristine,
			submitting,
			valid,
			error,
			openContactForm,
			icon,
			iconId,
		} = this.props;
		const { formFields } = this.state;
		return (
			<div className="presentation_container apply_rtl verification_container">
				<IconTitle
					stringId="USER_VERIFICATION.PAYMENT_VERIFICATION"
					text={STRINGS['USER_VERIFICATION.PAYMENT_VERIFICATION']}
					textType="title"
					iconPath={icon}
					iconId={iconId}
				/>
				<form className="d-flex flex-column w-100 verification_content-form-wrapper">
					<div className="verification-form-panel mt-3 mb-5">
						<HeaderSection
							stringId="USER_VERIFICATION.TITLE_PAYMENT"
							title={STRINGS['USER_VERIFICATION.TITLE_PAYMENT']}
							openContactForm={openContactForm}
						>
							<div className="my-2">
								<EditWrapper stringId="USER_VERIFICATION.PAYMENT_VERIFICATION_TEXT">
									{STRINGS['USER_VERIFICATION.PAYMENT_VERIFICATION_TEXT']}
								</EditWrapper>
							</div>
							<ul className="pl-4">
								<li className="my-1">
									<EditWrapper stringId="USER_VERIFICATION.BASE_WITHDRAWAL">
										{STRINGS['USER_VERIFICATION.BASE_WITHDRAWAL']}
									</EditWrapper>
								</li>
								<li className="my-1">
									<EditWrapper stringId="USER_VERIFICATION.BASE_DEPOSITS">
										{STRINGS['USER_VERIFICATION.BASE_DEPOSITS']}
									</EditWrapper>
								</li>
								<li className="my-1">
									<EditWrapper stringId="USER_VERIFICATION.WARNING.LIST_ITEM_3">
										{STRINGS['USER_VERIFICATION.WARNING.LIST_ITEM_3']}
									</EditWrapper>
								</li>
							</ul>
						</HeaderSection>
						{this.renderTabs()}
						{renderFields(formFields)}
						{error && (
							<div className="warning_text">{getErrorLocalized(error)}</div>
						)}
					</div>
					<div className="d-flex justify-content-center align-items-center mt-2">
						<div className="f-1 d-flex justify-content-end verification-buttons-wrapper">
							<EditWrapper stringId="USER_VERIFICATION.GO_BACK" />
							<Button
								label={STRINGS['USER_VERIFICATION.GO_BACK']}
								onClick={this.onGoBack}
							/>
						</div>
						<div className="separator" />
						<div className="f-1 verification-buttons-wrapper">
							<EditWrapper stringId="SUBMIT" />
							<Button
								label={STRINGS['SUBMIT']}
								type="button"
								onClick={handleSubmit(this.handleSubmit)}
								disabled={pristine || submitting || !valid || !!error}
							/>
						</div>
					</div>
				</form>
			</div>
		);
	}
}

const UserPaymentVerificationForm = reduxForm({
	form: FORM_NAME,
})(UserPaymentVerification);

const mapStateToProps = ({ app: { user_payment = {} } }) => {
	return {
		user_payment,
	};
};

export default connect(mapStateToProps)(
	withConfig(UserPaymentVerificationForm)
);
