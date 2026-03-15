import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
	apiKey: 'AIzaSyBA8fCjaFG8m72_BnqVoboUIYpzn5PgIyw',
	authDomain: 'tools-app-84d77.firebaseapp.com',
	projectId: 'tools-app-84d77',
	storageBucket: 'tools-app-84d77.firebasestorage.app',
	messagingSenderId: '599778539081',
	appId: '1:599778539081:web:5ba2baff568c8582a0b198',
};

export const app        = initializeApp(firebaseConfig);
export const auth       = getAuth(app);
export const firestore  = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
