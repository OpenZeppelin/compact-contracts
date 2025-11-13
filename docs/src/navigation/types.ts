export interface NavigationPage {
	type: "page";
	name: string;
	url: string;
	external?: boolean;
}

export interface NavigationFolder {
	type: "folder";
	name: string;
	defaultOpen?: boolean;
	index?: NavigationPage;
	children: NavigationNode[];
}

export interface NavigationSeparator {
	type: "separator";
	name: string;
}

export type NavigationNode =
	| NavigationPage
	| NavigationFolder
	| NavigationSeparator;

export interface NavigationTree {
	name: string;
	children: NavigationNode[];
}
