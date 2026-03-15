import { browser } from '$app/environment';
import { auth, googleProvider } from '$lib/firebase';
import {
	onAuthStateChanged,
	signInWithEmailAndPassword,
	createUserWithEmailAndPassword,
	signInWithPopup,
	linkWithPopup,
	linkWithCredential,
	EmailAuthProvider,
	signInAnonymously as _signInAnonymously,
	signOut as _signOut,
	type User,
} from 'firebase/auth';

export let authState = $state<{ user: User | null; loading: boolean }>({
	user: null,
	loading: true,
});

if (browser) {
	onAuthStateChanged(auth, (user) => {
		authState.user = user;
		authState.loading = false;
	});
}

export async function ensureAnonymousAuth() {
	if (!auth.currentUser) {
		await _signInAnonymously(auth);
	}
}

export async function signInWithEmail(email: string, password: string) {
	return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email: string, password: string) {
	// If currently anonymous, link instead of create — preserves UID and data
	if (auth.currentUser?.isAnonymous) {
		const credential = EmailAuthProvider.credential(email, password);
		return linkWithCredential(auth.currentUser, credential);
	}
	return createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithGoogle() {
	// If currently anonymous, link instead of sign-in — preserves UID and data
	if (auth.currentUser?.isAnonymous) {
		try {
			return await linkWithPopup(auth.currentUser, googleProvider);
		} catch (e: unknown) {
			const code = (e as { code?: string })?.code;
			if (code === 'auth/credential-already-in-use') {
				// Account already exists — just sign in (data stays under existing UID)
				return signInWithPopup(auth, googleProvider);
			}
			throw e;
		}
	}
	return signInWithPopup(auth, googleProvider);
}

export async function signOut() {
	return _signOut(auth);
}
