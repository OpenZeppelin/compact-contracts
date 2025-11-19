# AGENTS.md - OpenZeppelin Docs Codebase Guide

## Build/Lint/Test Commands
- `pnpm run build` - Build the Next.js application
- `pnpm run dev` - Start development server with turbo
- `pnpm run start` - Start production server
- `pnpm run postinstall` - Process MDX files with fumadocs-mdx
- `pnpm run lint` - Lint code with Biome
- `pnpm run lint:fix` - Lint and auto-fix issues with Biome
- `pnpm run format` - Check code formatting with Biome
- `pnpm run format:fix` - Format code with Biome
- `pnpm run check` - Run both linting and formatting checks
- `pnpm run check:fix` - Run both linting and formatting with auto-fix
- No test commands configured - this is a documentation site

## Navigation Management
The site uses a **modular JSON navigation system** instead of fumadocs meta.json files:

### Navigation Structure
- `src/navigation/` - Modular navigation configuration
  - `types.ts` - TypeScript interfaces for navigation
  - `contracts.json` - All contract-related navigation
  - `tools.json` - Tools section navigation
  - `ecosystems.json` - Ecosystem-specific sections
  - `index.ts` - Combines all sections into navigationTree

### Editing Navigation
- **Add new pages**: Edit the relevant JSON file (contracts/tools/ecosystems)
- **Reorder sections**: Modify array order in respective JSON files
- **Add new sections**: Create new JSON file and import in `index.ts`
- **Do NOT use meta.json files** - they have been removed and are not supported

## Code Style Guidelines

### TypeScript/JavaScript
- Use TypeScript strict mode (enabled in tsconfig.json)
- Prefer named imports: `import { RootProvider } from 'fumadocs-ui/provider'`
- Use path aliases: `@/*` for src/, `@/.source` for .source/
- Function components with explicit return types when needed
- Use React 19+ features and patterns

### File Structure
- Source files in `src/` directory
- Documentation content in `content/` with nested version folders (v2.x, v3.x, etc.)
- Examples in `examples/` directory organized by feature
- Public assets in `public/` directory
- Navigation config in `src/navigation/` directory

### Naming Conventions
- PascalCase for React components and interfaces
- camelCase for variables and functions
- kebab-case for file names in content directories

## Markdown Link Cleanup Strategy

### Problem
Legacy markdown files often contain complex, unreadable link syntax that creates URL-encoded URLs like:
```
http://localhost:3000/api/access#has_role(role:-felt252,-account:-contractaddress)-%E2%86%92-bool-external
```

### Solution Approach
When cleaning up markdown files with complex link syntax, follow this systematic approach:

#### 1. Identify Complex Link Patterns
Look for these problematic patterns:
- **Function list links**: `[`+function_name+`](#`[.contract-item-name]#`function_name`#`(params)``-[.item-kind]#external#)`
- **Event list links**: `[`+EventName+`](#`[.contract-item-name]#`eventname`#`(params)``-[.item-kind]#event#)`
- **Function headings**: `#### `[.contract-item-name]#`function_name`#`(params)`` [.item-kind]#external#`

#### 2. Create Clean Link Strategy
Replace with simple, readable format:
- **Clean list links**: `[`function_name`](#prefix-function_name)`
- **Clean headings with anchors**: 
  ```markdown
  <a id="prefix-function_name"></a>
  #### `function_name(params) → return_type`
  ```

#### 3. Anchor ID Naming Convention
Use descriptive prefixes to avoid conflicts:
- `iaccesscontrol-` for interface functions/events
- `component-` for component functions/events  
- `extension-` for extension functions/events

#### 4. Implementation Process
1. **Use Task agent** for systematic fixes across large files
2. **Fix by section** - group related functions/events together
3. **Update both links and targets** - ensure table of contents links point to correct anchors
4. **Verify no complex patterns remain** - search for `[.contract-item-name]#` and `[.item-kind]#`

#### 5. Benefits
- ✅ Clean, readable URLs
- ✅ Better SEO and user experience
- ✅ Easier maintenance and debugging
- ✅ Consistent markdown formatting

### Example Before/After

**Before (Complex):**
```markdown
* [`+has_role(role, account)+`](#`[.contract-item-name]#`has_role`#`(role:-felt252,-account:-contractaddress)-→-bool``-[.item-kind]#external#)

#### `[.contract-item-name]#`has_role`#`(role: felt252, account: ContractAddress) → bool`` [.item-kind]#external#
```

**After (Clean):**
```markdown
* [`has_role(role, account)`](#iaccesscontrol-has_role)

<a id="iaccesscontrol-has_role"></a>
#### `has_role(role: felt252, account: ContractAddress) → bool`
```

### Framework Compatibility Notes
- **DO NOT use `{#anchor}` syntax** - breaks the framework parser
- **USE HTML anchor tags** - `<a id="anchor-name"></a>` format is safe
- **Test locally** to ensure links work properly after changes
