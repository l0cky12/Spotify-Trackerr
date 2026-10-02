declare global {
	namespace App {
		interface Locals {
			user: Record<string, any> | null;
		}
	}
}

export {};
