COMPOSE_FILE := local-env.yml
LOGS_DIR := logs
SERVICES := proof-server indexer node

.PHONY: env-up env-down env-logs env-logs-clean env-status

## Start local environment and stream logs to logs/
env-up: env-down
	docker compose -f $(COMPOSE_FILE) up -d
	@mkdir -p $(LOGS_DIR)
	@for svc in $(SERVICES); do \
		docker compose -f $(COMPOSE_FILE) logs -f --no-log-prefix $$svc > $(LOGS_DIR)/$$svc.log 2>&1 & \
	done
	@echo "Logs streaming to $(LOGS_DIR)/"

## Stop local environment
env-down:
	@-pkill -f "docker compose -f $(COMPOSE_FILE) logs" 2>/dev/null || true
	docker compose -f $(COMPOSE_FILE) down

## Tail all logs
env-logs:
	tail -f $(LOGS_DIR)/*.log

## Clear log files
env-logs-clean:
	rm -rf $(LOGS_DIR)/*.log

## Show container status
env-status:
	docker compose -f $(COMPOSE_FILE) ps
