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

export let authState = $state<{ user: User | null; loading: boolean; failed: boolean }>({
	user: null,
	loading: true,
	failed: false,
});

if (browser) {
	onAuthStateChanged(auth, (user) => {
		authState.user = user;
		authState.loading = false;
	});
}

export async function ensureAnonymousAuth() {
	if (auth.currentUser) return;
	try {
		await _signInAnonymously(auth);
		authState.failed = false;
	} catch {
		// Without a session nothing can load or save, so the layout says so and offers a retry
		authState.failed = true;
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

/** Thrown when linking would strand data written during the anonymous session. */
export class AnonymousDataConflictError extends Error {
	constructor() {
		super('That account already exists.');
		this.name = 'AnonymousDataConflictError';
	}
}

/**
 * @param discardLocal when the Google account already exists, sign into it anyway and
 *        leave the anonymous session's data behind. Only pass true once the user has
 *        been told — silently dropping notes someone just wrote is not an option.
 */
export async function signInWithGoogle(discardLocal = false) {
	// If currently anonymous, link instead of sign-in — preserves UID and data
	if (auth.currentUser?.isAnonymous) {
		try {
			return await linkWithPopup(auth.currentUser, googleProvider);
		} catch (e: unknown) {
			const code = (e as { code?: string })?.code;
			if (code === 'auth/credential-already-in-use') {
				// Signing in now abandons everything under the anonymous UID. Ask first
				// unless the caller has already confirmed.
				if (!discardLocal) throw new AnonymousDataConflictError();
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
