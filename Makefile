# Makefile para Monitor Roblox

install:
	npm install

run:
	node monitor.js

test:
	node monitor.js --test

lint:
	npx eslint monitor.js

secrets:
	bash setup-secrets.sh

start-server-date:
	EXPOSE_SERVER_DATE=1 node monitor.js

# Inicia apenas o backend (monitor)
start-backend:
	@echo "Starting backend (monitor.js)..."
	node monitor.js

# Serve a pasta docs como frontend (usa npx http-server se não houver servidor local)
start-frontend:
	@echo "Starting frontend (docs) on http://localhost:8080"
	@npx http-server docs -p 8080

# Executa backend e frontend em conjunto para desenvolvimento/teste
# (backend roda em background; frontend em foreground. CTRL+C mata ambos)
dev:
	@echo "Starting development environment: backend + frontend"
	@node monitor.js & PID_BACK=$$!; \
	 npx http-server docs -p 8080 & PID_FE=$$!; \
	 trap 'echo "\nShutting down..."; kill "$$PID_BACK" "$$PID_FE" 2>/dev/null || true' EXIT; \
	 wait

clean:
	rm -f *.log

# Executa workflow local (simulação)
gha:
	gh workflow run monitor.yml

git-workflow:
	gh workflow run monitor.yml
	@echo "Workflow monitor.yml disparado via GitHub CLI."

# Ajuda
help:
	@echo "Comandos disponíveis:"
	@echo "  install           Instala dependências (npm install)"
	@echo "  run               Executa o monitor (node monitor.js)"
	@echo "  test              Executa testes (node monitor.js --test)"
	@echo "  lint              Executa lint (npx eslint monitor.js)"
	@echo "  secrets           Configura secrets via script (setup-secrets.sh)"
	@echo "  start-server-date Inicia endpoint de data do servidor"
	@echo "  clean             Remove arquivos de log"
	@echo "  gha               Executa workflow GitHub Actions local (gh workflow run)"
	@echo "  help              Mostra esta ajuda"
