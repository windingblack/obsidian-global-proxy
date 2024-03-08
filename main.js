var import_obsidian = require("obsidian");

const DEFAULT_SETTINGS = {
    enableProxy: false,
    httpProxy: "",
	httpsProxy: "",
	socksProxy: "",
	bypassProxy: ""
};

var GlobalProxyPlugin = class extends import_obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new GlobalProxySettingTab(this.app, this));
  }
  onunload() {
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	this.setGlobalProxy();
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  
  async setGlobalProxy() {
	  if (this.settings.enableProxy) {
			let proxyRules;
			try {
			  proxyRules = this.composeProxyRules();
			} catch(ex) {
				new import_obsidian.Notice(ex.message);
				return;
			}
			
			try {
				await electron.remote.session.defaultSession.setProxy({ proxyRules: proxyRules, proxyBypassRules: this.settings.bypassProxy }); 
				new import_obsidian.Notice('Global proxy set successfully');
			} catch (ex) {
				new import_obsidian.Notice('Global proxy set failed');
				console.error(ex.message);
			}
	  } else {
			try {
				const session = electron.remote.session.defaultSession
				await session.setProxy({});
				await session.closeAllConnections();
				new import_obsidian.Notice('Disable global proxy');
			} catch (ex) {
				new import_obsidian.Notice('Disable global proxy failed');
				console.error(ex.message);
			}
	  }
	}
	
	composeProxyRules() {
		const httpProxy= isValidFormat(this.settings.httpProxy) ? ";http=" + this.settings.httpProxy : "";
		const httpsProxy= isValidFormat(this.settings.httpsProxy) ? ";https=" + this.settings.httpsProxy : "";
		if (isValidFormat(this.settings.socksProxy)) {
			return this.settings.socksProxy + httpProxy + httpsProxy + ",direct://"
		} else if (!!httpProxy) {
			return !!httpsProxy ? "http=" + this.settings.httpProxy + httpsProxy + ",direct://"
				: this.settings.httpProxy + ",direct://"
		} else if (!!httpsProxy) {
			return this.settings.httpsProxy + ",direct://"
		} else {
			throw new Error("No valid proxy")
		}
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
	.setDesc("Change your proxy status")
	.addToggle((val) => val
	.setValue(this.plugin.settings.enableProxy)
	.onChange(async (value) =>  {
		this.plugin.settings.enableProxy = value;
		await this.plugin.saveSettings();
		this.plugin.setGlobalProxy();
    }));
	new import_obsidian.Setting(containerEl)
	.setName("Socks Proxy")
	.setDesc("Set up your socks proxy")
	.addText((text) => text
	.setPlaceholder("<scheme>://<host>:<port>")
	.setValue(this.plugin.settings.socksProxy)
	.onChange((value) => {
      this.refreshProxy("socksProxy", value); 
    }));
	new import_obsidian.Setting(containerEl)
	.setName("Http Proxy")
	.setDesc("Set up your http proxy")
	.addText((text) => text
	.setPlaceholder("<scheme>://<host>:<port>")
	.setValue(this.plugin.settings.httpProxy)
	.onChange((value) => {
	  this.refreshProxy("httpProxy", value); 
    }));
	new import_obsidian.Setting(containerEl)
	.setName("Https Proxy")
	.setDesc("Set up your https proxy")
	.addText((text) => text
	.setPlaceholder("<scheme>://<host>:<port>")
	.setValue(this.plugin.settings.httpsProxy)
	.onChange((value) => {
	  this.refreshProxy("httpsProxy", value);      
    }));
	new import_obsidian.Setting(containerEl)
	.setName("Bypass List")
	.setDesc("Set up your bypass list")
	.addText((text) => text
	.setPlaceholder("<scheme>://<host>:<port>")
	.setValue(this.plugin.settings.bypassProxy)
	.onChange((value) => {
	  this.refreshProxy("bypassProxy", value);      
    }));
  }
  async refreshProxy(key, value) {
	  if (isValidFormat(value) || key == 'bypassProxy') {
		this.plugin.settings[key] = value;
		await this.plugin.saveSettings();
		this.plugin.setGlobalProxy(); 
	  }
  }	
};


function isValidFormat(proxyUrl) {
  if (!!proxyUrl) {
	  const regex = /^(\w+):\/\/([^:/]+):(\d+)$/;
	  const matches = proxyUrl.match(regex);
	  return !!matches;
  }
  return false;
}

module.exports = GlobalProxyPlugin;
