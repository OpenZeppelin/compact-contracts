import { HomeLayout } from "fumadocs-ui/layouts/home";
import { ArrowDown, SendIcon } from "lucide-react";
import { Footer } from "@/components/footer";
import {
	BannerCard,
	CommunityCard,
	EcosystemCard,
	FeatureCard,
	HeroCard,
} from "@/components/home-cards";
import {
	AnnotationDotsIcon,
	ArbitrumIcon,
	ContractsLibraryIcon,
	ContractsMcpIcon,
	ContractsUpgradesIcon,
	ContractsWizardIcon,
	EthereumIcon,
	EthernautIcon,
	MidnightIcon,
	MonitorIcon,
	PolkadotIcon,
	RelayersIcon,
	StarknetIcon,
	StellarIcon,
	TransactionProposalIcon,
	UniswapIcon,
	ZamaIcon,
} from "@/components/icons";
import { DefenderIcon } from "@/components/icons/defender-icon";
import { baseOptions } from "./layout.config";

export default function HomePage() {
	return (
		<HomeLayout {...baseOptions}>
			<main className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-16 sm:pb-20 flex flex-col gap-12 sm:gap-16">
				{/* Hero Section */}
				<div className="text-center mb-6 sm:mb-8">
					<h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-3 sm:mb-4 px-2 sm:px-0">
						OpenZeppelin Documentation
					</h1>
					<p className="text-base sm:text-lg text-muted-foreground px-2 sm:px-0">
						Build secure blockchain applications with industry-standard smart
						contracts and developer tools
					</p>
				</div>

				{/* Smart Contracts Section */}
				<div className="mb-12 sm:mb-15">
					<h2 className="text-base sm:text-lg font-semibold mb-2">
						Smart Contracts
					</h2>

					{/* Primary Hero: OpenZeppelin Contracts */}
					<HeroCard
						href="/contracts"
						icon={
							<ContractsLibraryIcon className="h-10 w-10 sm:h-12 sm:w-12" />
						}
						title="OpenZeppelin Solidity Contracts"
						description="The world's most trusted library of Solidity smart contracts for Ethereum and EVM blockchains, powering nearly every onchain application."
					/>

					{/* Supporting Cards */}
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
						<FeatureCard
							href="/upgrades-plugins"
							icon={<ContractsUpgradesIcon className="h-6 w-6 sm:h-8 sm:w-8" />}
							title="Upgrades Plugins"
							description="Deploy upgradeable contracts using Hardhat and Foundry plugins that automate proxy deployments, enforce safety checks, and more."
						/>

						<FeatureCard
							href="/wizard"
							icon={<ContractsWizardIcon className="h-6 w-6 sm:h-8 sm:w-8" />}
							title="Contracts Wizard"
							description="Configure and generate smart contracts in seconds through an interactive interface."
						/>

						<FeatureCard
							href="https://mcp.openzeppelin.com"
							icon={<ContractsMcpIcon className="h-6 w-6 sm:h-8 sm:w-8" />}
							title="Contracts MCP"
							description="Write secure smart contracts that follow OpenZeppelin standards with your favorite AI assistant."
							className="sm:col-span-2 lg:col-span-1"
						/>
					</div>

					{/* Ecosystem Banner */}
					<div className="mt-6 group bg-card border rounded-xl p-4 sm:p-6 transition-all duration-300 cursor-pointer hover:shadow-sm hover:-translate-y-0.5 relative overflow-hidden hover:border-accent before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:bg-gradient-to-r before:from-[#4945ff] before:to-[#627eea] before:opacity-0 hover:before:opacity-100 before:transition-opacity">
						<a
							href="#ecosystems"
							className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-inherit no-underline gap-4 sm:gap-0"
						>
							<div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 md:gap-5 flex-1">
								<div className="flex gap-1.5 sm:gap-2">
									<div className="w-6 h-6 sm:w-8 sm:h-8 bg-muted/50 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:bg-muted/70">
										<EthereumIcon color className="w-3 h-3 sm:w-4 sm:h-4" />
									</div>
									<div className="w-6 h-6 sm:w-8 sm:h-8 bg-muted/50 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:bg-muted/70">
										<StarknetIcon color className="w-3 h-3 sm:w-4 sm:h-4" />
									</div>
									<div className="w-6 h-6 sm:w-8 sm:h-8 bg-muted/50 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:bg-muted/70">
										<StellarIcon className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
									</div>
									<div className="w-6 h-6 sm:w-8 sm:h-8 bg-muted/50 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:bg-muted/70">
										<ZamaIcon color className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
									</div>
									<div className="w-6 h-6 sm:w-8 sm:h-8 bg-muted/50 rounded-lg flex items-center justify-center text-xs text-muted-foreground transition-all duration-300 group-hover:bg-muted/70">
										+4
									</div>
								</div>
								<div className="text-xs sm:text-sm text-muted-foreground transition-colors duration-300 group-hover:text-foreground/80">
									Contracts libraries are also available for Starknet, Stellar,
									Zama FHEVM, and more blockchains
								</div>
							</div>
							<div className="px-3 py-2 rounded-lg text-xs sm:text-sm bg-fd-muted text-fd-muted-foreground font-medium transition-all duration-300 flex items-center gap-2 self-start sm:self-auto">
								Explore all
								<ArrowDown className="w-3 h-3 sm:w-4 sm:h-4" />
							</div>
						</a>
					</div>
				</div>
				{/* Divider */}
				<div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

				{/* Open Source Tools Section */}
				<div className="mb-12 sm:mb-15">
					<h2
						id="open-source-tools"
						className="text-base sm:text-lg font-semibold mb-2"
					>
						Open Source Tools
					</h2>

					{/* Dual Heroes: Monitor and Relayer */}
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
						<FeatureCard
							href="/relayer"
							icon={<RelayersIcon className="h-6 w-6 sm:h-8 sm:w-8" />}
							title="Relayer"
							description="Automate onchain transactions to schedule jobs, batch calls, and relay gasless meta transactions within your self-hosted infrastructure."
							glowColor="tools"
						/>

						<FeatureCard
							href="/monitor/1.1.x"
							icon={<MonitorIcon className="h-6 w-6 sm:h-8 sm:w-8" />}
							title="Monitor"
							description="Monitor onchain activity in real time to watch critical events, detect anomalies, trigger alerts on your preferred channels, and set automated responses with Relayer."
							glowColor="tools"
						/>
					</div>

					{/* Minor Tools */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
						<FeatureCard
							href="/ui-builder"
							icon={
								<TransactionProposalIcon className="h-6 w-6 sm:h-8 sm:w-8" />
							}
							title="UI Builder"
							description="Spin up user interfaces for any deployed contract. Select the function, auto-generate a React UI with wallet-connect and multi-network support, and export a complete app."
						/>

						<FeatureCard
							href="/defender"
							icon={<DefenderIcon className="h-5 w-5 sm:h-6 sm:w-6" />}
							title="Defender"
							description="Code, audit, deploy, monitor, and operate blockchain applications with OpenZeppelin's legacy developer security platform (maintenance mode)."
						/>
					</div>
				</div>

				{/* Divider */}
				<div
					id="ecosystems"
					className="h-px bg-gradient-to-r from-transparent via-border to-transparent"
				/>

				{/* Blockchains and Developer Ecosystems */}
				<div className="mb-12 sm:mb-15">
					<div className="mb-4 sm:mb-6 px-2 sm:px-0">
						<h2 className="text-base sm:text-lg font-semibold mb-2">
							Blockchains and Developer Ecosystems
						</h2>
						<p className="text-sm text-muted-foreground">
							Choose your blockchain platform to explore available contracts and
							tools
						</p>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
						<EcosystemCard
							href="/contracts"
							icon={<EthereumIcon color className="w-6 h-6" />}
							title="Ethereum & EVM"
							description="Build with Solidity smart contracts and developer tools for Ethereum and EVM chains"
							glowColor="evm"
						/>

						<EcosystemCard
							href="/contracts-cairo"
							icon={<StarknetIcon color className="w-7 h-7" />}
							title="Starknet"
							description="Develop Cairo smart contracts to build apps on Starknet zero-knowledge Layer 2"
							glowColor="starknet"
						/>

						<EcosystemCard
							href="/contracts-stylus"
							icon={<ArbitrumIcon color className="w-7 h-7" />}
							title="Arbitrum Stylus"
							description="Write high-performance smart contracts in Rust on the EVM with Arbitrum Stylus"
							glowColor="rust"
						/>

						<EcosystemCard
							href="/uniswap-hooks"
							icon={<UniswapIcon color className="w-7 h-7" />}
							title="Uniswap Hooks"
							description="Customize Uniswap V4 hooks with advanced, audited modules"
							glowColor="uniswap"
						/>

						<EcosystemCard
							href="/stellar-contracts"
							icon={<StellarIcon className="w-5 h-5" />}
							title="Stellar"
							description="Build with Soroban smart contracts and developer tools on Stellar"
							glowColor="stellar"
						/>

						<EcosystemCard
							href="/contracts-compact"
							icon={<MidnightIcon className="w-5 h-5" />}
							title="Midnight"
							description="Build privacy-preserving smart contracts in Compact for the Midnight blockchain"
							glowColor="midnight"
						/>

						<EcosystemCard
							href="/substrate-runtimes"
							icon={<PolkadotIcon color className="w-7 h-7" />}
							title="Polkadot"
							description="Develop smart contracts and parachain runtimes for Polkadot and Substrate"
							glowColor="polkadot"
						/>

						<EcosystemCard
							href="/confidential-contracts"
							icon={<ZamaIcon color className="w-5 h-5" />}
							title="Zama FHEVM"
							description="Implement fully homomorphic encryption for confidential smart contracts in Solidity"
							glowColor="zama"
						/>
					</div>
				</div>

				{/* Learn & Play Section */}
				<div className="mb-12 sm:mb-15">
					<div className="mb-4 sm:mb-6 px-2 sm:px-0">
						<h2 className="text-base sm:text-lg font-semibold mb-2">
							Learn &amp; Play
						</h2>
						<p className="text-sm text-muted-foreground">
							Master smart contract security through interactive challenges
						</p>
					</div>

					{/* Ethernaut CTF as standalone */}
					<BannerCard
						href="https://ethernaut.openzeppelin.com/"
						icon={<EthernautIcon className="h-10 w-10 sm:h-12 sm:w-12" />}
						title="Ethernaut CTF"
						description="Learn smart contract security by hacking. Ethernaut is a capture-the-flag game where each level is a vulnerable contract to exploit. Master real-world attack vectors and defense strategies through hands-on challenges."
						badge="Interactive Learning"
					/>
				</div>

				{/* Community & Support */}
				<div className="mb-12 sm:mb-15">
					<div className="mb-4 sm:mb-6 px-2 sm:px-0">
						<h2 className="text-base sm:text-lg font-semibold mb-2">
							Community &amp; Support
						</h2>
						<p className="text-sm text-muted-foreground">
							Connect with the community for technical discussions and support
						</p>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
						<CommunityCard
							href="https://forum.openzeppelin.com/"
							icon={<AnnotationDotsIcon className="h-6 w-6 sm:h-8 sm:w-8" />}
							title="Forum"
							description="Engage in technical deep-dives and architectural discussions. Get detailed answers, share your implementations, and learn from experienced developers building in production."
						/>

						<CommunityCard
							href="https://t.me/openzeppelin_tg"
							icon={<SendIcon className="h-6 w-6 sm:h-8 sm:w-8" />}
							title="Telegram"
							description="Get quick help and connect with the community in real-time. Ask questions, share updates, and stay informed about the latest OpenZeppelin developments and announcements."
						/>
					</div>
				</div>
			</main>
			<Footer />
		</HomeLayout>
	);
}
