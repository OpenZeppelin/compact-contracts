.PHONY: help setup install build-submodule submodule-init submodule-update

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: submodule-init build-submodule install ## Complete setup: init submodules, build compact-tools, and install dependencies
	@echo "✅ Setup complete!"

install: ## Install dependencies for the main project
	@echo "📦 Installing dependencies..."
	@yarn install

build-submodule: ## Build the compact-tools submodule
	@echo "🔨 Building compact-tools submodule..."
	@cd compact-tools && yarn && yarn build

submodule-init: ## Initialize git submodules
	@echo "📥 Initializing submodules..."
	@git submodule update --init --recursive

submodule-update: ## Update submodules to latest commits and rebuild
	@echo "🔄 Updating submodules..."
	@git submodule update --remote
	@echo "🔨 Rebuilding compact-tools..."
	@$(MAKE) build-submodule
	@echo "📦 Updating lockfile..."
	@yarn install
	@echo "✅ Submodules updated!"
