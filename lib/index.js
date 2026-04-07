'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const JsSIP = require('jssip');

const DEFAULT_WS_URL = 'wss://sip.yemot.co.il/ws';
const DEFAULT_SIP_DOMAIN = 'sip.yemot.co.il';
const DEFAULT_SIP_REALM = 'sip.yemot.co.il.wss';

/**
 * SIP digest HA1 = MD5(username:realm:password)
 * @param {string} username
 * @param {string} realm
 * @param {string} password
 * @returns {string}
 */
function createSipHA1(username, realm, password) {
  const data = `${username}:${realm}:${password}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

function ensureNodeWebSocket() {
  if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = require('ws');
  }
}

/**
 * @typedef {object} YemotSmsClientOptions
 * @property {string} sipUser - SIP user part for your line (before @domain), e.g. extension from the system.
 * @property {string} password - Plain SIP password (HA1 is derived internally).
 * @property {string} [wsUrl]
 * @property {string} [domain]
 * @property {string} [realm] - Digest realm; default sip.yemot.co.il. Override if your registrar uses another realm.
 */

/**
 * @typedef {object} IncomingSms
 * @property {string|null} from - Full SIP URI of sender (for sendMessage).
 * @property {string} fromUser - User part only.
 * @property {string} body
 * @property {(text: string) => void} reply - Send a SIP MESSAGE back to the same peer.
 */

class YemotSmsClient extends EventEmitter {
  /**
   * @param {YemotSmsClientOptions} options
   */
  constructor(options) {
    super();
    if (!options || typeof options.sipUser !== 'string' || !options.sipUser) {
      throw new Error('YemotSmsClient: sipUser is required');
    }
    if (typeof options.password !== 'string' || !options.password) {
      throw new Error('YemotSmsClient: password is required');
    }

    this._opts = {
      sipUser: options.sipUser,
      password: options.password,
      wsUrl: options.wsUrl ?? DEFAULT_WS_URL,
      domain: options.domain ?? DEFAULT_SIP_DOMAIN,
      realm: options.realm ?? DEFAULT_SIP_REALM,
    };

    this._ua = null;
    this._running = false;
  }

  /** @returns {boolean} */
  get started() {
    return this._running;
  }

  _digestUsername() {
    return this._opts.authorizationUser ?? this._opts.sipUser;
  }

  _buildLocalUri() {
    return `sip:${this._opts.sipUser}@${this._opts.domain}`;
  }

  /**
   * Normalize target: full sip: URI or dial/user part only.
   * @param {string} to
   * @returns {string}
   */
  _toSipUri(to) {
    const t = String(to).trim();
    if (t.toLowerCase().startsWith('sip:')) return t;
    return `sip:${t}@${this._opts.domain}`;
  }

  _bindUa() {
    if (!this._ua) return;

    this._ua.on('registered', () => this.emit('registered'));
    this._ua.on('unregistered', () => this.emit('unregistered'));
    this._ua.on('registrationFailed', (e) => this.emit('registrationFailed', e));
    this._ua.on('disconnected', (e) => this.emit('disconnected', e));

    this._ua.on('newMessage', (data) => {
      if (data.originator !== 'remote') return;
      const remote = data.message?.remote_identity;
      const uri = remote?.uri;
      const fromUser = uri?.user != null ? String(uri.user) : String(remote ?? '');
      const from = uri ? uri.toString() : null;
      const body = data.request?.body != null ? String(data.request.body) : '';

      /** @type {IncomingSms} */
      const incoming = {
        from,
        fromUser,
        body,
        reply: (text) => {
          if (!from) {
            throw new Error('YemotSmsClient.reply: missing remote SIP URI');
          }
          this.sendMessage(from, text);
        },
      };

      this.emit('message', incoming);
    });
  }

  /**
   * Connect WebSocket, register (if enabled), and listen for MESSAGE.
   */
  start() {
    if (this._running) return;

    ensureNodeWebSocket();

    const digestUser = this._digestUsername();
    const ha1 = createSipHA1(digestUser, 'sip.yemot.co.il', this._opts.password);
    const socket = new JsSIP.WebSocketInterface(this._opts.wsUrl);

    const configuration = {
      sockets: [socket],
      uri: this._buildLocalUri(),
      ha1,
      realm: this._opts.realm,
      register: true,
    };

    if (this._opts.authorizationUser) {
      configuration.authorization_user = this._opts.authorizationUser;
    }
    if (this._opts.displayName) {
      configuration.display_name = this._opts.displayName;
    }

    this._ua = new JsSIP.UA(configuration);
    this._bindUa();
    this._ua.start();
    this._running = true;
  }

  /**
   * @param {string} to - sip:user@domain or user part (same domain as client).
   * @param {string} text
   */
  sendMessage(to, text) {
    if (!this._ua || !this._running) {
      throw new Error('YemotSmsClient.sendMessage: call start() first');
    }
    this._ua.sendMessage(this._toSipUri(to), String(text));
  }

  stop() {
    if (!this._ua) {
      this._running = false;
      return;
    }
    try {
      this._ua.stop();
    } finally {
      this._ua = null;
      this._running = false;
      this.emit('stopped');
    }
  }
}

module.exports = {
  YemotSmsClient,
  createSipHA1,
  DEFAULT_WS_URL,
  DEFAULT_SIP_DOMAIN,
  DEFAULT_SIP_REALM,
};
