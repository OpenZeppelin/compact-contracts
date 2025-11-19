"use client";

import { allVersions } from "content/relayer/latest-versions";
import { VersionSelector } from "./version-selector";

export function RelayerVersionSelector() {
	return <VersionSelector pathPrefix="/relayer" versions={allVersions} />;
}
