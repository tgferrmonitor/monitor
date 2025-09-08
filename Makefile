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
