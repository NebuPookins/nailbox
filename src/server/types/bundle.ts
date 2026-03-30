export interface BundleDto {
	bundleId: string;
	threadIds: string[];
	createdAt: number;
}

export interface CreateBundleRequestDto {
	threadIds: string[];
}
