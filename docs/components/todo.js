// Todo List Component para Monitor Roblox
class TodoList {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.todos = this.loadTodos();
    this.render();
  }

  loadTodos() {
    const saved = localStorage.getItem('monitorTodos');
    if (saved) {
      return JSON.parse(saved);
    }

    // Todos padrão do projeto
    return [
      {
        id: 1,
        title: 'Estruturar frontend em arquivos separados',
        description:
          'Separar HTML, CSS e JS em arquivos distintos e organizar em pastas',
        status: 'completed',
        priority: 'high',
      },
      {
        id: 2,
        title: 'Implementar Material Design responsivo',
        description:
          'Refatorar o frontend para usar Material Design, com tema claro/escuro e visual moderno',
        status: 'completed',
        priority: 'high',
      },
      {
        id: 3,
        title: 'Reativar notificações por email no backend',
        description:
          'Garantir que o monitor.js envie notificações por email normalmente',
        status: 'completed',
        priority: 'medium',
      },
      {
        id: 4,
        title: 'Monitorar jogadores em tempo real',
        description:
          'Verificar status dos jogadores a cada 5 minutos via GitHub Actions',
        status: 'completed',
        priority: 'high',
      },
      {
        id: 5,
        title: 'Otimizar armazenamento S3',
        description:
          'Melhorar estrutura de dados para reduzir tamanho dos arquivos JSON',
        status: 'in-progress',
        priority: 'medium',
      },
      {
        id: 6,
        title: 'Adicionar métricas de performance',
        description:
          'Implementar dashboard com tempo de resposta e estatísticas gerais',
        status: 'not-started',
        priority: 'low',
      },
    ];
  }

  saveTodos() {
    localStorage.setItem('monitorTodos', JSON.stringify(this.todos));
  }

  addTodo(title, description, priority = 'medium') {
    const newTodo = {
      id: Date.now(),
      title,
      description,
      status: 'not-started',
      priority,
      createdAt: new Date().toISOString(),
    };
    this.todos.push(newTodo);
    this.saveTodos();
    this.render();
  }

  updateTodoStatus(id, status) {
    const todo = this.todos.find((t) => t.id === id);
    if (todo) {
      todo.status = status;
      todo.updatedAt = new Date().toISOString();
      this.saveTodos();
      this.render();
    }
  }

  deleteTodo(id) {
    this.todos = this.todos.filter((t) => t.id !== id);
    this.saveTodos();
    this.render();
  }

  getStatusIcon(status) {
    const icons = {
      'not-started': '⭕',
      'in-progress': '🔄',
      completed: '✅',
    };
    return icons[status] || '❓';
  }

  getPriorityClass(priority) {
    const classes = {
      high: 'priority-high',
      medium: 'priority-medium',
      low: 'priority-low',
    };
    return classes[priority] || 'priority-medium';
  }

  render() {
    const stats = this.getStats();

    this.container.innerHTML = `
      <div class="todo-header">
        <h3>📋 Todo List genérico</h3>
        <div class="todo-stats">
          <span class="stat completed">${stats.completed} Concluídas</span>
          <span class="stat in-progress">${stats.inProgress} Em Progresso</span>
          <span class="stat not-started">${stats.notStarted} Pendentes</span>
        </div>
      </div>

      <div class="todo-add">
        <button class="btn secondary" onclick="todoList.showAddForm()">➕ Nova Tarefa</button>
      </div>

      <div id="todoAddForm" class="todo-form" style="display: none;">
        <input type="text" id="todoTitle" placeholder="Título da tarefa" />
        <textarea id="todoDescription" placeholder="Descrição detalhada"></textarea>
        <select id="todoPriority">
          <option value="low">Baixa Prioridade</option>
          <option value="medium" selected>Média Prioridade</option>
          <option value="high">Alta Prioridade</option>
        </select>
        <div class="form-actions">
          <button class="btn" onclick="todoList.submitTodo()">Adicionar</button>
          <button class="btn secondary" onclick="todoList.hideAddForm()">Cancelar</button>
        </div>
      </div>

      <div class="todo-list">
        ${this.todos.map((todo) => this.renderTodo(todo)).join('')}
      </div>
    `;
  }

  renderTodo(todo) {
    return `
      <div class="todo-item ${todo.status} ${this.getPriorityClass(
      todo.priority
    )}">
        <div class="todo-content">
          <div class="todo-header-item">
            <span class="todo-status">${this.getStatusIcon(todo.status)}</span>
            <h4 class="todo-title">${todo.title}</h4>
            <span class="todo-priority">${todo.priority.toUpperCase()}</span>
          </div>
          <p class="todo-description">${todo.description}</p>
        </div>
        <div class="todo-actions">
          <select onchange="todoList.updateTodoStatus(${todo.id}, this.value)">
            <option value="not-started" ${
              todo.status === 'not-started' ? 'selected' : ''
            }>Não Iniciada</option>
            <option value="in-progress" ${
              todo.status === 'in-progress' ? 'selected' : ''
            }>Em Progresso</option>
            <option value="completed" ${
              todo.status === 'completed' ? 'selected' : ''
            }>Concluída</option>
          </select>
          <button class="btn-delete" onclick="todoList.deleteTodo(${
            todo.id
          })" title="Excluir">🗑️</button>
        </div>
      </div>
    `;
  }

  getStats() {
    return {
      completed: this.todos.filter((t) => t.status === 'completed').length,
      inProgress: this.todos.filter((t) => t.status === 'in-progress').length,
      notStarted: this.todos.filter((t) => t.status === 'not-started').length,
      total: this.todos.length,
    };
  }

  showAddForm() {
    document.getElementById('todoAddForm').style.display = 'block';
  }

  hideAddForm() {
    document.getElementById('todoAddForm').style.display = 'none';
    document.getElementById('todoTitle').value = '';
    document.getElementById('todoDescription').value = '';
    document.getElementById('todoPriority').value = 'medium';
  }

  submitTodo() {
    const title = document.getElementById('todoTitle').value.trim();
    const description = document.getElementById('todoDescription').value.trim();
    const priority = document.getElementById('todoPriority').value;

    if (title && description) {
      this.addTodo(title, description, priority);
      this.hideAddForm();
    } else {
      alert('Preencha título e descrição!');
    }
  }
}

// CSS adicional para todo list
const todoCSS = `
.todo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 16px;
}

.todo-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.stat {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
}

.stat.completed {
  background-color: var(--status-online);
  color: white;
}

.stat.in-progress {
  background-color: var(--status-playing);
  color: white;
}

.stat.not-started {
  background-color: var(--status-offline);
  color: white;
}

.todo-add {
  margin-bottom: 16px;
}

.todo-form {
  background-color: var(--md-sys-color-surface-variant);
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 16px;
}

.todo-form input,
.todo-form textarea,
.todo-form select {
  width: 100%;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 8px;
  background-color: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
}

.todo-form textarea {
  resize: vertical;
  min-height: 60px;
}

.form-actions {
  display: flex;
  gap: 8px;
}

.todo-item {
  background-color: var(--md-sys-color-surface);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 8px;
  border-left: 4px solid var(--md-sys-color-outline);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.todo-item.completed {
  border-left-color: var(--status-online);
  opacity: 0.8;
}

.todo-item.in-progress {
  border-left-color: var(--status-playing);
}

.todo-item.not-started {
  border-left-color: var(--status-offline);
}

.todo-item.priority-high {
  box-shadow: 0 2px 8px rgba(244, 67, 54, 0.2);
}

.todo-content {
  flex: 1;
}

.todo-header-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.todo-status {
  font-size: 1.2rem;
}

.todo-title {
  flex: 1;
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
}

.todo-priority {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 8px;
  background-color: var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.todo-description {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.875rem;
  line-height: 1.4;
}

.todo-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.todo-actions select {
  padding: 6px 8px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 6px;
  background-color: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  font-size: 0.75rem;
}

.btn-delete {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  font-size: 1rem;
  transition: background-color 0.3s ease;
}

.btn-delete:hover {
  background-color: var(--md-sys-color-error-container);
}

@media (max-width: 768px) {
  .todo-item {
    flex-direction: column;
    align-items: stretch;
  }

  .todo-actions {
    justify-content: space-between;
    margin-top: 12px;
  }

  .todo-header {
    flex-direction: column;
    align-items: stretch;
  }

  .todo-stats {
    justify-content: center;
  }
}
`;

// Injetar CSS
const style = document.createElement('style');
style.textContent = todoCSS;
document.head.appendChild(style);

// Inicializar todo list quando DOM estiver pronto
let todoList;
document.addEventListener('DOMContentLoaded', function () {
  // Criar container do todo list se não existir
  if (!document.getElementById('todoContainer')) {
    const main = document.querySelector('main');
    if (main) {
      const todoContainer = document.createElement('section');
      todoContainer.id = 'todoContainer';
      todoContainer.className = 'card';
      todoContainer.style.marginTop = '16px';
      main.parentNode.insertBefore(todoContainer, main.nextSibling);
    }
  }

  todoList = new TodoList('todoContainer');
});
