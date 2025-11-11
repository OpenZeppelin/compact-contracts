# OpenZeppelin Docs

![cover](public/social.png)

Welcome to the OpenZeppelin Docs repo! Before opening an issue or creating a PR please consult our [contribution guide](CONTRIBUTING.md) as well as the [OpenZeppelin Documentation Standards](STANDARDS.md)

## Development

This is a Next.js application generated with [Fumadocs](https://github.com/fuma-nama/fumadocs).

To start local development follow the steps below

**1. Make sure [pnpm](https://pnpm.io) is installed**

```bash
pnpm --version
```

**2. Clone the repo and install dependencies**

```bash
git clone https://github.com/OpenZeppelin/docs
cd docs
pnpm install
```

**3. Run the `dev` server to see a live preview and have your changes reflected at `http://localhost:3000`**

```bash
pnpm dev
```

**4. Run `build` and `lint`**

```bash
pnpm run build
pnpm run check
```

## Project Structure

### Content Organization

The documentation content is organized in the `content/` directory with the following structure:

```
content/
├── community-contracts/     # Community-contributed contracts
├── confidential-contracts/  # Confidential/privacy-focused contracts
├── contracts/              # Core OpenZeppelin Contracts documentation
├── contracts-cairo/        # Cairo contracts for StarkNet
├── contracts-compact/      # Compact contract implementations
├── contracts-stylus/       # Stylus contracts for Arbitrum
├── ui-builder/   # UI Builder documentation
├── defender/               # Defender platform documentation
├── monitor/                # Monitoring tools documentation
├── relayer/                # Relayer service documentation
├── stellar-contracts/      # Stellar blockchain contracts
├── substrate-runtimes/     # Substrate runtime documentation
├── uniswap-hooks/          # Uniswap v4 hooks
├── upgrades-plugins/       # Upgrade plugins documentation
├── upgrades.mdx           # General upgrades guide
└── wizard.mdx             # Contract wizard documentation
```

Each product directory contains:
- `index.mdx` - Main documentation entry point
- `changelog.mdx` - Version history and changes
- Subdirectories for specific features/modules
- API reference files

### Application Structure

| Path                                    | Description                                                    |
| --------------------------------------- | -------------------------------------------------------------- |
| `src/app/(docs)/`                      | Documentation pages route group                               |
| `src/app/(docs)/layout.tsx`           | Docs layout wrapper                                           |
| `src/app/(docs)/[...slug]/page.tsx`   | Dynamic documentation pages                                    |
| `src/app/page.tsx`                     | Homepage                                                       |
| `src/app/layout.tsx`                   | Root application layout                                        |
| `src/app/layout.config.tsx`           | Shared layout configuration and navigation                     |
| `src/components/`                      | Reusable React components                                      |
| `src/components/layout/`               | Layout-specific components                                     |
| `src/components/icons/`                | Custom SVG icons for products                                  |
| `src/components/ui/`                   | UI component library                                           |
| `src/lib/source.ts`                    | Content source adapter with Fumadocs loader                   |

### Configuration Files

- `source.config.ts` - Fumadocs MDX configuration with math, mermaid, and code highlighting
- `next.config.mjs` - Next.js configuration
- `postcss.config.mjs` - PostCSS configuration for styling

## Navigation & Components

### Navigation Structure

The top navigation is configured in `src/app/layout.config.tsx` and includes:

- **Main Navigation**: Home, Forum, Website links
- **Product Categories**: Auto-generated from content structure
- **Search**: Full-text search across all documentation
- **Theme Toggle**: Light/dark mode switching

Sidebar navigation is handled in `src/navigation/` where multiple navigation JSON trees are exported and used inside `src/components/layout/docs-layout-client.tsx`

### Key Components

#### Layout Components
- `DocsLayoutClient` - Client-side docs layout with sidebar
- `BaseLayoutProps` - Shared layout configuration
- `PageClient` - Individual page wrapper

#### UI Components
- `Card` & `SmallCard` - Content cards for homepage
- `TOC` - Table of contents with scrollspy
- `Search` - Search interface with custom results
- `ThemeToggle` - Theme switching
- `VersionBanner` - Version-specific messaging

#### Custom Icons
Product-specific icons located in `src/components/icons/`:
- Ethereum, Arbitrum, StarkNet, Stellar, Polkadot chains
- Product icons for Contracts, Defender, Monitor, etc.
- Tool icons for Wizard, Ethernaut, etc.

### Content Features

#### MDX Enhancements
- **Math Support**: LaTeX math rendering with KaTeX
- **Mermaid Diagrams**: Flowcharts and diagrams
- **Code Highlighting**: Multi-theme syntax highlighting
- **OpenAPI Integration**: Automatic API documentation generation

#### Interactive Elements
- **OpenZeppelin Wizard**: Embedded contract generation tool
- **Code Examples**: Copy-to-clipboard functionality
- **Version Switching**: Multi-version documentation support
- **Responsive Design**: Mobile-optimized navigation and content

## Solidity Docgen

Any library using Solidity Docgen can utilize the `docgen` templates and config file in their repo to generate markdown API references for the docs. To get started follow the instructions below:

### 1. Add the templates to your repo

Inside this docs repo is the [`docgen`](https://github.com/OpenZeppelin/docs/tree/main/docgen) folder which contains [`templates-md`](https://github.com/OpenZeppelin/docs/tree/main/docgen/templates-md) and [`config-md.js`](https://github.com/OpenZeppelin/docs/blob/main/docgen/config-md.js). Copy both of these items into your `docs` folder in your repo. Once there open the [`templates-md/helpers.js`](https://github.com/OpenZeppelin/docs/blob/main/docgen/templates-md/helpers.js) file and update the `API_DOCS_PATH` constant to match your export path.

```js
const API_DOCS_PATH = 'contracts/5.x/api';
// const API_DOCS_PATH = 'community-contracts/api';
// const API_DOCS_PATH = 'confidential-contracts/api';
// const API_DOCS_PATH = 'uniswap-hooks/api';
```

### 2. Update the `hardhat.config.js` file

With the `config-md.js` file now in the `docs` folder, update your `hardhat.config.js` to use the new config file.

```js
{
  // other config options
  docgen: require('./docs/config-md'),
}
```

Once added make sure these are accessible in your branches going forward. If you are generating an API reference for previous branches you will need to repeat steps 1 and 2 for those branches.

### 3. Run the `generate-api-docs.js` script

With your remote repo setup with the new template files you can run the `scripts/generate-api-docs.js` script. Be sure to pass in the correct arguements for your docs

```bash
node scripts/generate-api-docs.js \
  --repo https://github.com/OpenZeppelin/openzeppelin-community-contracts.git \
  --branch release-v5.5 \
  --api-output content/contracts/5.x/api \
  --examples-output examples
```

This wil lexport the contents to

### Automated Setup

In the case you want to setup an automated GitHub workflow to create these API docs visit the [docs-api-generation-workflows](https://github.com/OpenZeppelin/docs-api-generation-workflows) for more info. This repo (`OpenZeppelin/docs`) is the `Docs Receiver` side of the equation.

## Content Management

### Adding New Content

1. Create `.mdx` files in appropriate `content/` subdirectories
2. Use frontmatter for metadata (title, description, etc.)
3. Follow existing directory structure for consistency
4. Update navigation if adding new product categories

### Versioning

- Version-specific content in numbered subdirectories (e.g., `contracts/4.x/`)
- Latest content at root level of each product directory
- Automatic version detection and routing

## Learn More

To learn more about the technologies used:

- [Next.js Documentation](https://nextjs.org/docs) - React framework features and API
- [Fumadocs](https://fumadocs.vercel.app) - Documentation framework
- [MDX](https://mdxjs.com/) - Markdown with JSX components
