import jwtDecode from 'jwt-decode';
import { TOKEN_KEY } from '../config/constants';

const TOKEN_TIME_KEY = 'time';

export const getToken = () => {
	return localStorage.getItem(TOKEN_KEY);
};

export const setToken = (token) => {
	localStorage.setItem(TOKEN_KEY, token);
	localStorage.setItem(TOKEN_TIME_KEY, new Date().getTime());
};

export const removeToken = () => {
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(TOKEN_TIME_KEY);
};

export const getTokenTimestamp = () => {
	return localStorage.getItem(TOKEN_TIME_KEY);
};

export const isLoggedIn = () => {
	let token = getToken();
	return !!token;
}

export const decodeToken = (token) => jwtDecode(token);

export const checkRole = () => {
	const token = getToken();
	const roles = jwtDecode(token).scopes;
	let role = '';
	if (roles.includes('admin')) {
		role = 'admin';
	} else if (roles.includes('supervisor')) {
		role = 'supervisor';
	} else if (roles.includes('support')) {
		role = 'support';
	} else if (roles.includes('kyc')) {
		role = 'kyc';
	}
	return role;
};

export const isUser = () => {
	return checkRole() === '';
};
export const isKYC = () => {
	return checkRole() === 'kyc';
};
export const isSupport = () => {
	return checkRole() === 'support';
};
export const isSupervisor = () => {
	return checkRole() === 'supervisor';
};
export const isAdmin = () => {
	return checkRole() === 'admin';
};
