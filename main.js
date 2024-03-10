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
  }
  
  async onunload() {
    this.disableProxy()
  }
  
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	this.sessionMap = {}
	this.enableProxy();
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  
  async enableProxy() {
		if (!this.settings.enableProxy) {
			return;
		}
	  
		let sessions = []
		this.sessionMap.default = electron.remote.session.defaultSession
		sessions.push(this.sessionMap.default)
		  
		if (!!this.settings.pluginTokens) {
			let pluginTokens = this.settings.pluginTokens.split("\n");
			for (var i = 0; i < pluginTokens.length; i++) {
				if (!pluginTokens[i]) {
					continue;
				}
				let token = pluginTokens[i].replace("${appId}", this.app.appId)
				let session = await electron.remote.session.fromPartition(token)
				sessions.push(session)
				this.sessionMap[token] = session
			}
		}

		let proxyRules = this.composeProxyRules(), 
			proxyBypassRules = proxyRules ? this.settings.bypassRules : undefined;

		for (var i = 0; i < sessions.length; i++) {
			await sessions[i].setProxy({ proxyRules, proxyBypassRules }); 
		}

		if (proxyRules) {
			new import_obsidian.Notice('Enable proxy!');
		}
	}
	
	
	async disableProxy() {
		let sessions = []
		for (const key in this.sessionMap) {
			sessions.push(this.sessionMap[key])
		}
				
		for (var i = 0; i < sessions.length; i++) {
			await sessions[i].setProxy({});
			await sessions[i].closeAllConnections();
		}
		new import_obsidian.Notice('Disable proxy!');
	}
	
	
	composeProxyRules() {
		if (!["socksProxy", "httpProxy", "httpsProxy"].
			map((p) => !this.settings[p] || isValidFormat(this.settings[p])).reduce((res, check)=>{return res && check}, true)) {
			return undefined;
		}
		
		
		const httpProxy= isValidFormat(this.settings.httpProxy) ? ";http=" + this.settings.httpProxy : "";
		const httpsProxy= isValidFormat(this.settings.httpsProxy) ? ";https=" + this.settings.httpsProxy : "";
		if (isValidFormat(this.settings.socksProxy)) {
			return this.settings.socksProxy + httpProxy + httpsProxy + ",direct://"
		} else if (!!httpProxy) {
			return !!httpsProxy ? "http=" + this.settings.httpProxy + httpsProxy + ",direct://"
				: this.settings.httpProxy + ",direct://"
		} else if (!!httpsProxy) {
			return this.settings.httpsProxy + ",direct://"
		}
		
		return undefined;
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
		value ? this.plugin.enableProxy() : this.plugin.disableProxy();
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
	.setName("Plugin Tokens")
	.setDesc("For proxy specified plugins")
	.addTextArea((text) => text
	.setValue(this.plugin.settings.pluginTokens)
	.onChange((value) => {
	  this.refreshProxy("pluginTokens", value);  
    }));
	new import_obsidian.Setting(containerEl)
	.setName("Blacklist")
	.setDesc("Proxy blacklist")
	.addTextArea((text) => text
	.setPlaceholder("[URL_SCHEME://] HOSTNAME_PATTERN [:<port>]\n. HOSTNAME_SUFFIX_PATTERN [:PORT]\n[SCHEME://] IP_LITERAL [:PORT]\nIP_LITERAL / PREFIX_LENGTH_IN_BITS\n<local>")
	.setValue(this.plugin.settings.bypassRules)
	.onChange((value) => {
	  this.refreshProxy("bypassRules", value);      
    }));
  }
  async refreshProxy(key, value) {
	  this.plugin.settings[key] = value;
	  this.plugin.saveSettings();
	  
	  this.plugin.enableProxy(); 
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
