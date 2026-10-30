// Where the backend lives and the key it expects. Both come from Vite environment
// variables (a .env.local file, or build arguments in Docker), so nothing is hard-coded.
//
// Note: anything built into a browser app can be read by whoever loads the page, so this
// key identifies "our frontend", not a user. A multi-user deployment would sign users in
// (e.g. OAuth) and keep secrets on the server.
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
export const API_KEY: string = import.meta.env.VITE_API_KEY ?? '';
