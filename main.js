var import_obsidian = require("obsidian");

const DEFAULT_SETTINGS = {
    enableProxy: false,
    httpProxy: "",
    httpsProxy: "",
    socksProxy: "",
    bypassRules: "<local>,127.*,10.*,172.16.*,172.17.*,172.18.*,172.19.*,172.20.*,172.21.*,172.22.*,172.23.*,172.24.*,172.25.*,172.26.*,172.27.*,172.28.*,172.29.*,172.30.*,172.31.*,192.168.*",
    pluginTokens: "persist:surfing-vault-${appId}"
};

var GlobalProxyPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new GlobalProxySettingTab(this.app, this));
    this.loginHandlers = new Map(); // Для отслеживания обработчиков
  }
  
  async onunload() {
    await this.disableProxy();
  }
  
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.sessionMap = {};
    await this.enableProxy();
  }
  
  async saveSettings() {
    await this.saveData(this.settings);
  }
  
  getElectronSession() {
    // Пробуем разные способы получения session
    try {
      // Сначала пробуем @electron/remote
      const remoteModule = require('@electron/remote');
      if (remoteModule && remoteModule.session) {
        return remoteModule.session;
      }
    } catch (e) {
      // Если @electron/remote не доступен
    }
    
    try {
      // Пробуем старый remote API
      const electron = require('electron');
      if (electron.remote && electron.remote.session) {
        return electron.remote.session;
      }
    } catch (e) {
      // Если и старый API не доступен
    }
    
    // В крайнем случае пробуем прямой доступ
    try {
      const { session } = require('electron');
      if (session) {
        return session;
      }
    } catch (e) {
      console.error('Unable to access Electron session API');
    }
    
    return null;
  }
  
  async enableProxy() {
    if (!this.settings.enableProxy) {
      return;
    }
    
    const sessionModule = this.getElectronSession();
    if (!sessionModule) {
      new import_obsidian.Notice('Error: Cannot access Electron session API');
      return;
    }
    
    let sessions = [];
    this.sessionMap.default = sessionModule.defaultSession;
    sessions.push(this.sessionMap.default);
      
    if (this.settings.pluginTokens) {
      let pluginTokens = this.settings.pluginTokens.split("\n");
      for (let token of pluginTokens) {
        if (!token || !token.trim()) {
          continue;
        }
        token = token.trim().replace("${appId}", this.app.appId);
        try {
          let sessionObj = sessionModule.fromPartition(token);
          sessions.push(sessionObj);
          this.sessionMap[token] = sessionObj;
        } catch (e) {
          console.error(`Failed to create session for token: ${token}`, e);
        }
      }
    }

    let proxyRules = this.composeProxyRules();
    let proxyBypassRules = proxyRules ? this.settings.bypassRules : undefined;

    // Сначала устанавливаем прокси для всех сессий
    for (let session of sessions) {
      try {
        await session.setProxy({ 
          proxyRules: proxyRules || "", 
          proxyBypassRules: proxyBypassRules || "" 
        });
        
        // Затем настраиваем аутентификацию
        this.setupProxyAuth(session);
      } catch (e) {
        console.error('Failed to set proxy for session', e);
      }
    }

    if (proxyRules) {
      new import_obsidian.Notice('Proxy enabled successfully!');
    }
  }
  
  setupProxyAuth(session) {
    // Удаляем старый обработчик если есть
    const oldHandler = this.loginHandlers.get(session);
    if (oldHandler) {
      session.removeListener('login', oldHandler);
      this.loginHandlers.delete(session);
    }
    
    // Получаем данные аутентификации
    const proxyAuth = this.extractAuthFromSettings();
    
    if (proxyAuth && proxyAuth.username && proxyAuth.password) {
      // Создаем новый обработчик
      const loginHandler = (event, webContents, details, authInfo, callback) => {
        // Проверяем что это запрос аутентификации от прокси
        if (authInfo.isProxy) {
          event.preventDefault();
          // Небольшая задержка для стабильности
          setTimeout(() => {
            callback(proxyAuth.username, proxyAuth.password);
          }, 100);
        } else {
          // Если это не прокси-аутентификация, пропускаем
          callback();
        }
      };
      
      session.on('login', loginHandler);
      this.loginHandlers.set(session, loginHandler);
    }
  }
  
  extractAuthFromSettings() {
    const proxies = [
      { type: 'http', value: this.settings.httpProxy },
      { type: 'https', value: this.settings.httpsProxy },
      { type: 'socks', value: this.settings.socksProxy }
    ];
    
    for (const proxy of proxies) {
      if (proxy.value && proxy.value.trim()) {
        // Улучшенное регулярное выражение для разных форматов
        // Поддерживает: scheme://user:pass@host:port
        const authMatch = proxy.value.match(/^(\w+):\/\/([^:@]+):([^@]+)@([^:]+):(\d+)$/);
        if (authMatch) {
          return {
            scheme: authMatch[1],
            username: decodeURIComponent(authMatch[2]),
            password: decodeURIComponent(authMatch[3]),
            host: authMatch[4],
            port: authMatch[5]
          };
        }
        
        // Альтернативный формат без схемы: user:pass@host:port
        const simpleAuthMatch = proxy.value.match(/^([^:@]+):([^@]+)@([^:]+):(\d+)$/);
        if (simpleAuthMatch) {
          return {
            scheme: proxy.type,
            username: decodeURIComponent(simpleAuthMatch[1]),
            password: decodeURIComponent(simpleAuthMatch[2]),
            host: simpleAuthMatch[3],
            port: simpleAuthMatch[4]
          };
        }
      }
    }
    return null;
  }
  
  async disableProxy() {
    let sessions = [];
    for (const key in this.sessionMap) {
      if (this.sessionMap[key]) {
        sessions.push(this.sessionMap[key]);
      }
    }
    
    for (let session of sessions) {
      try {
        // Удаляем обработчик логина
        const handler = this.loginHandlers.get(session);
        if (handler) {
          session.removeListener('login', handler);
          this.loginHandlers.delete(session);
        }
        
        // Сбрасываем прокси
        await session.setProxy({});
        
        // Закрываем соединения для применения изменений
        await session.closeAllConnections();
      } catch (e) {
        console.error('Failed to disable proxy for session', e);
      }
    }
    
    new import_obsidian.Notice('Proxy disabled!');
  }
  
  composeProxyRules() {
    // Проверяем валидность всех прокси
    const validProxies = ["socksProxy", "httpProxy", "httpsProxy"]
      .every(p => !this.settings[p] || isValidFormat(this.settings[p]));
    
    if (!validProxies) {
      new import_obsidian.Notice('Invalid proxy format detected!');
      return undefined;
    }
    
    // Функция для удаления аутентификации из URL
    const stripAuth = (url) => {
      if (!url) return "";
      // Удаляем user:pass@ из URL
      return url.replace(/^(\w+):\/\/[^@]+@/, '$1://');
    };
    
    // Формируем правила прокси
    let rules = [];
    
    if (isValidFormat(this.settings.socksProxy)) {
      rules.push(stripAuth(this.settings.socksProxy));
    }
    
    if (isValidFormat(this.settings.httpProxy)) {
      rules.push("http=" + stripAuth(this.settings.httpProxy));
    }
    
    if (isValidFormat(this.settings.httpsProxy)) {
      rules.push("https=" + stripAuth(this.settings.httpsProxy));
    }
    
    if (rules.length === 0) {
      return undefined;
    }
    
    // Добавляем direct:// в конец для обхода прокси по bypass rules
    return rules.join(";") + ",direct://";
  }
};

var GlobalProxySettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  display() {
    const { containerEl } = this;
    containerEl.empty();
    
    new import_obsidian.Setting(containerEl)
      .setName("Enable proxy")
      .setDesc("Toggle proxy on/off")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableProxy)
        .onChange(async (value) => {
          this.plugin.settings.enableProxy = value;
          await this.plugin.saveSettings();
          if (value) {
            await this.plugin.enableProxy();
          } else {
            await this.plugin.disableProxy();
          }
        }));
    
    new import_obsidian.Setting(containerEl)
      .setName("SOCKS Proxy")
      .setDesc("SOCKS proxy configuration (e.g., socks5://user:pass@host:port)")
      .addText((text) => text
        .setPlaceholder("socks5://[user:pass@]host:port")
        .setValue(this.plugin.settings.socksProxy)
        .onChange(async (value) => {
          await this.refreshProxy("socksProxy", value);
        }));

    new import_obsidian.Setting(containerEl)
      .setName("HTTP Proxy")
      .setDesc("HTTP proxy configuration (e.g., http://user:pass@host:port)")
      .addText((text) => text
        .setPlaceholder("http://[user:pass@]host:port")
        .setValue(this.plugin.settings.httpProxy)
        .onChange(async (value) => {
          await this.refreshProxy("httpProxy", value);
        }));

    new import_obsidian.Setting(containerEl)
      .setName("HTTPS Proxy")
      .setDesc("HTTPS proxy configuration (e.g., http://user:pass@host:port)")
      .addText((text) => text
        .setPlaceholder("http://[user:pass@]host:port")
        .setValue(this.plugin.settings.httpsProxy)
        .onChange(async (value) => {
          await this.refreshProxy("httpsProxy", value);
        }));
    
    new import_obsidian.Setting(containerEl)
      .setName("Plugin Tokens")
      .setDesc("Session tokens for specific plugins (one per line)")
      .addTextArea((text) => text
        .setValue(this.plugin.settings.pluginTokens)
        .onChange(async (value) => {
          await this.refreshProxy("pluginTokens", value);
        }));
    
    new import_obsidian.Setting(containerEl)
      .setName("Bypass Rules")
      .setDesc("Hosts to bypass proxy (comma-separated)")
      .addTextArea((text) => text
        .setPlaceholder("<local>, 192.168.*, *.local")
        .setValue(this.plugin.settings.bypassRules)
        .onChange(async (value) => {
          await this.refreshProxy("bypassRules", value);
        }));
  }
  
  async refreshProxy(key, value) {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
    
    if (this.plugin.settings.enableProxy) {
      await this.plugin.enableProxy();
    }
  }
};

function isValidFormat(proxyUrl) {
  if (!proxyUrl || !proxyUrl.trim()) {
    return false;
  }
  
  // Регулярное выражение для проверки формата прокси
  // Поддерживает: scheme://[user:pass@]host:port
  const regex = /^(\w+):\/\/(?:([^:@]+):([^@]+)@)?([^:/]+):(\d+)$/;
  
  // Альтернативный формат без схемы
  const simpleRegex = /^(?:([^:@]+):([^@]+)@)?([^:/]+):(\d+)$/;
  
  return regex.test(proxyUrl) || simpleRegex.test(proxyUrl);
}

module.exports = GlobalProxyPlugin;
