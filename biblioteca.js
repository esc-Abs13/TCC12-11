'use strict';

const API_BASE_URL = 'https://tcc-smartreader.onrender.com';
let livrosData = [];

// Elementos DOM
const booksGrid = document.getElementById('books-grid');
const searchInput = document.getElementById('library-search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const libraryStatus = document.getElementById('library-status');
const statusMsg = document.getElementById('status-msg');
const toast = document.getElementById('toast');
const libraryFileInput = document.getElementById('fileInput');
const libraryUploadZone = document.getElementById('upload-zone');
const uploadedBooksGrid = document.getElementById('uploaded-books-grid');
const modalAuth = document.getElementById('modal-auth');
const formAuth = document.getElementById('form-auth');
const authEmail = document.getElementById('auth-email');
const authSenha = document.getElementById('auth-senha');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const authTitle = document.getElementById('auth-title');
const authToggleLink = document.getElementById('auth-toggle-link');
const authToggleMsg = document.getElementById('auth-toggle-msg');
const btnFecharAuth = document.getElementById('btn-fechar-auth');
const UPLOADED_BOOKS_KEY = 'sr_uploaded_books';
let modoCadastro = false;

function isPdfFile(file) {
  return !!file && (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
}

function getUploadedBooks() {
  try {
    return JSON.parse(localStorage.getItem(UPLOADED_BOOKS_KEY) || '[]');
  } catch {
    return [];
  }
}

function setUploadedBooks(books) {
  localStorage.setItem(UPLOADED_BOOKS_KEY, JSON.stringify(books));
}

function getUploadedBookKey(fileName) {
  return `uploaded_pdf_${fileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function savePDFToIndexedDB(fileName, arrayBuffer, storageKey = 'current_pdf') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SmartReaderDB', 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs');
      }
    };

    request.onsuccess = (event) => {
      try {
        const db = event.target.result;
        const tx = db.transaction('pdfs', 'readwrite');
        tx.objectStore('pdfs').put(arrayBuffer, storageKey);
        localStorage.setItem('sr_current_filename', fileName);
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

function renderUploadedBooks() {
  if (!uploadedBooksGrid) return;

  const uploadedBooks = getUploadedBooks();

  if (!uploadedBooks.length) {
    uploadedBooksGrid.innerHTML = `
      <div class="empty-state" style="padding: 1.2rem; border: 1px dashed var(--border); border-radius: 12px; background: rgba(255,255,255,0.02);">
        <p style="margin: 0; color: var(--text-sec);">Nenhum PDF enviado ainda.</p>
      </div>
    `;
    return;
  }

  uploadedBooksGrid.innerHTML = uploadedBooks.map((book) => `
    <article class="book-card uploaded-book-card" tabindex="0" aria-label="Arquivo enviado: ${book.name}">
      <div class="book-cover-placeholder" style="display:flex; align-items:center; justify-content:center; font-size: 2rem;">📄</div>
      <h2 class="book-title">${book.name}</h2>
      <p class="book-author">${book.sizeLabel}</p>
      <button class="btn-action btn-read-book" aria-label="Abrir arquivo ${book.name}">Abrir</button>
    </article>
  `).join('');

  uploadedBooksGrid.querySelectorAll('.btn-read-book').forEach((button, index) => {
    button.addEventListener('click', async () => {
      const fileName = uploadedBooks[index].name;
      const bookKey = getUploadedBookKey(fileName);
      try {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('SmartReaderDB', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        const result = await new Promise((resolve, reject) => {
          const tx = db.transaction('pdfs', 'readonly');
          const req = tx.objectStore('pdfs').get(bookKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });

        if (!result) {
          showToast('Arquivo não encontrado localmente.', 'error');
          return;
        }

        await savePDFToIndexedDB(fileName, result, 'current_pdf');
        localStorage.setItem('sr_current_filename', fileName);
        window.location.href = 'leitor.html?uploaded=1';
      } catch (error) {
        console.error('Erro ao abrir arquivo salvo:', error);
        showToast('Não foi possível abrir este PDF salvo.', 'error');
      }
    });
  });
}

function syncUploadedBook(fileName, sizeInBytes) {
  const uploadedBooks = getUploadedBooks();
  const exists = uploadedBooks.some((book) => book.name === fileName);

  if (!exists) {
    uploadedBooks.unshift({
      name: fileName,
      sizeLabel: `${(sizeInBytes / 1024).toFixed(0)} KB`,
      uploadedAt: new Date().toISOString()
    });
    setUploadedBooks(uploadedBooks.slice(0, 10));
  }

  renderUploadedBooks();
}

function openUploadedPDF(file) {
  if (!isPdfFile(file)) {
    showToast('Selecione um arquivo PDF válido.', 'error');
    return;
  }

  showToast('Abrindo documento no leitor...', 'success');

  file.arrayBuffer()
    .then(async (buffer) => {
      const bookKey = getUploadedBookKey(file.name);
      await savePDFToIndexedDB(file.name, buffer, 'current_pdf');
      await savePDFToIndexedDB(file.name, buffer, bookKey);
      syncUploadedBook(file.name, file.size);
      localStorage.setItem('sr_current_filename', file.name);
      window.location.href = 'leitor.html?uploaded=1';
    })
    .catch((error) => {
      console.error('Erro ao abrir PDF enviado:', error);
      showToast('Não foi possível abrir este PDF.', 'error');
    });
}

/* ─── SHOW TOAST ─── */
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = `toast show${type ? ' toast-' + type : ''}`;
  setTimeout(() => { toast.className = 'toast'; }, 2800);
}

/* ─── CARREGAR LIVROS DA API ─── */
async function fetchLivros() {
  try {
    libraryStatus.textContent = "Buscando acervo no servidor...";
    const response = await fetch(`${API_BASE_URL}/api/livros`);
    if (!response.ok) throw new Error('Falha ao obter lista de livros');

    livrosData = await response.json();
    renderBooks(livrosData);
  } catch (err) {
    console.error(err);
    libraryStatus.textContent = "Erro ao carregar os livros. Certifique-se de que o servidor está rodando.";
    showToast("Erro ao conectar com a API", "error");
  }
}

/* ─── RENDERIZAR CARDS COM ACESSIBILIDADE ─── */
function renderBooks(books) {
  booksGrid.innerHTML = '';
  const serverNotice = document.getElementById('server-notice');
  if (serverNotice) serverNotice.style.display = 'none';

  if (!books || books.length === 0) {
    libraryStatus.textContent = "Nenhum livro encontrado.";
    return;
  }

  libraryStatus.textContent = `Exibindo ${books.length} livro(s) disponível(eis).`;

  books.forEach(book => {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `Livro: ${book.titulo || 'Sem título'}`);

    const pdfUrl = `${API_BASE_URL}/api/proxy-pdf?url=${encodeURIComponent(book.url_pdf)}`;

  card.innerHTML = `
  <div class="book-cover-placeholder">
    ${
      book.capa_url
        ? `<img 
            src="${book.capa_url}" 
            alt="Capa do livro ${book.titulo || 'Sem título'}"
            class="book-cover-image"
          >`
        : `<span aria-hidden="true">◈</span>`
    }
  </div>

  <h2 class="book-title">
    ${book.titulo || 'Sem título'}
  </h2>

  <p class="book-author">
    ${book.autor || 'Autor desconhecido'}
  </p>

  <button
    class="btn-action btn-read-book"
    aria-label="Ler o livro ${book.titulo || 'Sem título'}"
  >
    Abrir Leitura
  </button>
`;

    // Redireciona o usuário para abrir o PDF diretamente na aplicação de leitura
    const readBtn = card.querySelector('.btn-read-book');
    const openBook = () => {
      // Salva a referência no localStorage para o SmartReader consumir
      localStorage.setItem('sr_current_filename', book.titulo || 'Livro Selecionado');
      // Redireciona apontando o proxy para o player
      window.location.href = `leitor.html?pdf=${encodeURIComponent(pdfUrl)}&title=${encodeURIComponent(book.titulo || '')}`;
    };

    readBtn.addEventListener('click', openBook);
    booksGrid.appendChild(card);
  });
}

/* ─── FILTRO DE BUSCA ─── */
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  const filtered = livrosData.filter(b => 
    (b.titulo && b.titulo.toLowerCase().includes(query)) ||
    (b.autor && b.autor.toLowerCase().includes(query))
  );
  renderBooks(filtered);
});

btnClearSearch.addEventListener('click', () => {
  searchInput.value = '';
  renderBooks(livrosData);
  searchInput.focus();
});

/* ─── RECURSOS DE VOZ / TTS DO CATÁLOGO ─── */
document.getElementById('btn-read-catalog').addEventListener('click', () => {
  if (typeof speechSynthesis === 'undefined') return;

  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    showToast('Leitura interrompida');
    return;
  }

  const titles = Array.from(document.querySelectorAll('.book-title')).map(el => el.textContent);
  if (titles.length === 0) {
    showToast('Nenhum livro para ler', 'error');
    return;
  }

  const textToRead = "Livros disponíveis no catálogo: " + titles.join(', ');
  const utter = new SpeechSynthesisUtterance(textToRead);
  utter.lang = 'pt-BR';
  speechSynthesis.speak(utter);
  showToast('Lendo catálogo em voz alta...');
});

/* ─── VLIBRAS TRIGGER ─── */
document.getElementById('btn-libras').addEventListener('click', () => {
  const vlibrasText = document.getElementById('vlibras-text');
  const titles = Array.from(document.querySelectorAll('.book-title')).map(el => el.textContent);
  
  if (titles.length === 0) return;

  vlibrasText.textContent = '';
  requestAnimationFrame(() => {
    vlibrasText.textContent = "Catálogo de livros: " + titles.join('. ');
  });
  showToast('Texto enviado para o VLibras', 'success');
});

/* ─── SIDEBAR RESPONSIVA ─── */
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.getElementById('btn-open-sidebar').style.display = 'flex';
});

document.getElementById('btn-open-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('collapsed');
  document.getElementById('btn-open-sidebar').style.display = 'none';
});

/* ─── TROCA DE TEMAS E RESTAURAÇÃO ─── */
function initTheme() {
  const themeButtons = document.querySelectorAll('.btn-theme');
  const savedTheme = localStorage.getItem('sr_theme') || 'theme-dark';

  // Aplica o tema na raiz e no body
  document.documentElement.className = savedTheme;
  document.body.className = savedTheme;

  // Atualiza os botões
  themeButtons.forEach(b => {
    const isActive = b.dataset.theme === savedTheme;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  // Listener para troca
  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      document.documentElement.className = theme;
      document.body.className = theme;
      localStorage.setItem('sr_theme', theme);

      themeButtons.forEach(b => {
        const isActive = b.dataset.theme === theme;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    });
  });
}

if (libraryFileInput && libraryUploadZone) {
  libraryFileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) {
      openUploadedPDF(file);
    }
  });

  libraryUploadZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    libraryUploadZone.classList.add('drag-over');
  });

  libraryUploadZone.addEventListener('dragleave', () => {
    libraryUploadZone.classList.remove('drag-over');
  });

  libraryUploadZone.addEventListener('drop', (event) => {
    event.preventDefault();
    libraryUploadZone.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      openUploadedPDF(file);
    }
  });

  libraryUploadZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      libraryFileInput.click();
    }
  });
}

async function atualizarInterfaceUsuario() {
  const btnConta = document.querySelectorAll('section.sidebar-section button').length
    ? Array.from(document.querySelectorAll('section.sidebar-section button')).find(b => b.textContent.includes('Entrar') || b.textContent.includes('Sair'))
    : null;

  if (!btnConta || !window.supabaseClient) return;

  try {
    const { data: { user } } = await window.supabaseClient.auth.getUser();

    if (user) {
      const nomeUsuario = user.email.split('@')[0];
      btnConta.innerText = `👤 ${nomeUsuario} (Sair)`;
      btnConta.onclick = fazerLogout;
    } else {
      btnConta.innerText = '👤 Entrar / Cadastrar';
      btnConta.onclick = abrirLogin;
    }
  } catch (error) {
    console.error('Erro ao atualizar estado do usuário:', error);
  }
}

async function fazerLogout() {
  if (!window.supabaseClient) return;
  await window.supabaseClient.auth.signOut();
  alert('Você saiu da conta.');
  atualizarInterfaceUsuario();
}

authToggleLink?.addEventListener('click', (e) => {
  e.preventDefault();
  modoCadastro = !modoCadastro;
  authTitle.innerText = modoCadastro ? 'Criar Conta' : 'Entrar';
  btnAuthSubmit.innerText = modoCadastro ? 'Cadastrar' : 'Entrar';
  authToggleMsg.innerText = modoCadastro ? 'Já tem conta?' : 'Não tem conta?';
  authToggleLink.innerText = modoCadastro ? 'Fazer Login' : 'Criar conta';
});

btnFecharAuth?.addEventListener('click', () => {
  if (modalAuth) modalAuth.style.display = 'none';
});

formAuth?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmail.value;
  const password = authSenha.value;

  try {
    if (modoCadastro) {
      const { error } = await window.supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      alert('Conta criada com sucesso!');
    } else {
      const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      alert('Login realizado!');
    }
    modalAuth.style.display = 'none';
    atualizarInterfaceUsuario();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
});

function abrirLogin() {
  if (modalAuth) modalAuth.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  fetchLivros();
  renderUploadedBooks();
  setTimeout(atualizarInterfaceUsuario, 300);
});

// Atualiza quando o usuário volta para a biblioteca
window.addEventListener('focus', () => {
  fetchLivros();
});

// Também atualiza ao voltar pelo botão do navegador
window.addEventListener('pageshow', () => {
  fetchLivros();
});

