// SPDX-License-Identifier: Apache-2.0
/* global require, __dirname, global, process, Buffer */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
let modal = null;
let documentRoot = null;
let canvasFixture = null;
let scriptAppendHandler = null;
const notifications = [];
const pollEntries = [];
const appendedScripts = [];

if (!String.prototype.format) {
	Object.defineProperty(String.prototype, 'format', {
		value: function() {
			const args = arguments;
			let index = 0;

			return String(this).replace(/%[sd]/g, function() {
				return String(args[index++]);
			});
		}
	});
}

function element(tag, attrs, children) {
	if (Array.isArray(tag)) {
		children = tag;
		attrs = {};
		tag = null;
	}
	else if (attrs == null || Array.isArray(attrs) || typeof attrs !== 'object') {
		children = attrs;
		attrs = {};
	}

	const node = {
		tag,
		attrs: attrs || {},
		children: children == null ? [] : (Array.isArray(children) ? children : [ children ]),
		style: { display: '' },
		disabled: attrs?.disabled != null,
		appendChild: function(child) {
			this.children.push(child);
		},
		getAttribute: function(name) {
			return this.attrs[name] ?? null;
		},
		setAttribute: function(name, value) {
			this.attrs[name] = value;

			if (name === 'class')
				this.className = value;
			else if (name === 'disabled')
				this.disabled = true;
			else
				this[name] = value;
		},
		removeAttribute: function(name) {
			delete this.attrs[name];
			delete this[name];
		},
		focus: function() {
			global.document.activeElement = this;
			this.focusCount = (this.focusCount || 0) + 1;
		},
		click: function() {
			this.clickCount = (this.clickCount || 0) + 1;

			if (typeof this.attrs.click === 'function')
				return this.attrs.click({ currentTarget: this, target: this });
		}
	};
	node.classList = {
		add: function(name) {
			const values = new Set(String(node.className || '').split(/\s+/).filter(Boolean));

			values.add(name);
			node.className = Array.from(values).join(' ');
			node.attrs.class = node.className;
		},
		remove: function(name) {
			node.className = String(node.className || '').split(/\s+/).filter(function(value) {
				return value && value !== name;
			}).join(' ');
			node.attrs.class = node.className;
		},
		contains: function(name) {
			return String(node.className || '').split(/\s+/).includes(name);
		}
	};

	if (typeof node.attrs.style === 'string') {
		node.attrs.style.split(';').forEach(function(rule) {
			const parts = rule.split(':');

			if (parts.length > 1)
				node.style[parts.shift().trim()] = parts.join(':').trim();
		});
	}

	if (node.attrs.class != null)
		node.className = node.attrs.class;

	if ([ 'input', 'select', 'textarea' ].includes(tag))
		node.value = node.attrs.value || '';

	if (tag === 'input' && node.attrs.type === 'file')
		node.files = [];

	if (tag === 'select') {
		const selected = node.children.find(function(child) {
			return child?.tag === 'option' && child.attrs?.selected != null;
		});

		if (selected)
			node.value = selected.attrs.value;
	}

	return node;
}

function walk(value, callback) {
	if (Array.isArray(value)) {
		value.forEach(function(item) { walk(item, callback); });
		return;
	}

	if (!value || typeof value !== 'object')
		return;

	callback(value);
	walk(value.children, callback);
	walk(value.rows, callback);
}

function findAll(root, predicate) {
	const matches = [];

	walk(root, function(node) {
		if (predicate(node))
			matches.push(node);
	});

	return matches;
}

function textContent(node) {
	if (Array.isArray(node))
		return node.map(textContent).join('');

	if (typeof node === 'string')
		return node;

	if (!node || typeof node !== 'object')
		return '';

	if (Object.prototype.hasOwnProperty.call(node, 'textContent'))
		return node.textContent;

	return (node.children || []).map(textContent).join('');
}

global._ = function(value) { return value; };
global.E = element;
global.L = {
	hasViewPermission: function() { return true; },
	resolveDefault: function(value) { return value; },
	resource: function(value) { return `/luci-static/resources/${value}`; }
};
global.cbi_update_table = function(table, rows, empty) {
	table.rows = rows;
	table.empty = empty;
};
global.document = {
	activeElement: null,
	getElementById: function(id) {
		return findAll(documentRoot, function(node) {
			return node.attrs?.id === id;
		})[0] || null;
	},
	createElement: function(tag) {
		if (tag === 'canvas') {
			return {
				width: 0,
				height: 0,
				getContext: function() {
					return {
						drawImage: function() {},
						getImageData: function(x, y, width, height) {
							if (canvasFixture) {
								assert.strictEqual(width, canvasFixture.width);
								assert.strictEqual(height, canvasFixture.height);
								return { data: canvasFixture.data };
							}

							return { data: new Uint8ClampedArray(width * height * 4) };
						}
					};
				}
			};
		}

		return { tag, async: false };
	},
	head: {
		appendChild: function(script) {
			appendedScripts.push(script);

			if (scriptAppendHandler)
				return scriptAppendHandler(script);

			throw new Error(`unexpected external script load: ${script.src}`);
		}
	}
};
function memoryStorage() {
	const values = new Map();

	return {
		getItem: function(key) {
			return values.has(key) ? values.get(key) : null;
		},
		setItem: function(key, value) {
			values.set(String(key), String(value));
		},
		removeItem: function(key) {
			values.delete(String(key));
		},
		clear: function() {
			values.clear();
		}
	};
}

const storageListeners = [];
const browserStorage = memoryStorage();

global.window = {
	location: { reload: function() {} },
	localStorage: browserStorage,
	atob: global.atob,
	addEventListener: function(type, callback) {
		if (type === 'storage')
			storageListeners.push(callback);
	},
	dispatchStorage: function(key) {
		storageListeners.forEach(function(callback) {
			callback({ key });
		});
	}
};

const view = { extend: function(spec) { return spec; } };
const ui = {
	showModal: function(title, content) { modal = { title, content }; },
	hideModal: function() { modal = null; },
	addNotification: function(title, content, level) {
		notifications.push({ title, content, level });
	},
	createHandlerFn: function(context, handler) {
		const args = Array.prototype.slice.call(arguments, 2);

		return function() {
			return typeof handler === 'string'
				? context[handler].apply(context, args)
				: handler.apply(context, args);
		};
	}
};
const poll = {
	add: function(callback, interval) {
		pollEntries.push({ callback, interval });
	}
};
const lpac = {
	dataOr: function(result, fallback) {
		return result && result.success ? result.data : fallback;
	},
	errorMessage: function(result) { return result?.error || 'error'; }
};

function loadView(relativePath) {
	const source = fs.readFileSync(path.join(appRoot, 'htdocs/luci-static/resources/view/lpac', relativePath), 'utf8');
	return Function('view', 'ui', 'poll', 'lpac', source)(view, ui, poll, lpac);
}

function loadLpacClient(declarations) {
	const source = fs.readFileSync(path.join(appRoot,
		'htdocs/luci-static/resources/lpac.js'), 'utf8');
	const rpc = {
		declare: function(spec) {
			if (declarations)
				declarations.push(spec);

			return function() { return Promise.resolve({}); };
		}
	};
	const baseclass = { extend: function(spec) { return spec; } };

	return Function('rpc', 'baseclass', source)(rpc, baseclass);
}

function byText(root, tag, label) {
	return findAll(root, function(node) {
		return node.tag === tag && textContent(node) === label;
	});
}

function qrPixels(rows, scale) {
	const sourceWidth = rows[0].length;
	const width = sourceWidth * scale;
	const height = rows.length * scale;
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const dark = rows[Math.floor(y / scale)][Math.floor(x / scale)] === '1';
			const offset = (y * width + x) * 4;
			const channel = dark ? 0 : 255;

			data[offset] = channel;
			data[offset + 1] = channel;
			data[offset + 2] = channel;
			data[offset + 3] = 255;
		}
	}

	return { data, width, height };
}

const rpcDeclarations = [];
const actualLpacClient = loadLpacClient(rpcDeclarations);
[ 'getDownloadVerification', 'requireDownloadVerification',
	'settleDownloadVerification', 'markDownloadVerification' ].forEach(function(name) {
	lpac[name] = actualLpacClient[name].bind(actualLpacClient);
});
lpac.profileIconUri = actualLpacClient.profileIconUri;
lpac.validSmdpAddress = actualLpacClient.validSmdpAddress;
lpac.downloadVerificationStorageKey = actualLpacClient.downloadVerificationStorageKey;
lpac.downloadVerificationStoragePrefix =
	actualLpacClient.downloadVerificationStoragePrefix;

function rpcDeclaration(method) {
	return rpcDeclarations.find(function(spec) { return spec.method === method; });
}

assert.deepStrictEqual(rpcDeclaration('discover_profiles').params,
	[ 'smds', 'imei' ],
	'SM-DS discovery should expose only its address and optional IMEI');
assert.deepStrictEqual(rpcDeclaration('download_discovered_profile').params,
	[ 'entry_id', 'confirmation_code' ],
	'a discovered download should exchange only its opaque entry and confirmation code');
assert.deepStrictEqual(rpcDeclaration('get_download_status').params,
	[ 'job_id', 'decision_token' ],
	'owned status polling must carry the tab-scoped preview decision token');
assert.deepStrictEqual(rpcDeclaration('respond_download_preview').params,
	[ 'job_id', 'decision_token', 'accept' ],
	'preview approval must identify the exact owned job and one-time decision token');
assert.deepStrictEqual(rpcDeclaration('process_notification').params,
	[ 'seq', 'remove_after_success' ],
	'provider processing should operate on one explicit notification sequence');
assert.deepStrictEqual(rpcDeclaration('set_default_smdp').params,
	[ 'address' ],
	'the persistent eUICC default update should expose one typed address argument');
const settingsSource = fs.readFileSync(path.join(appRoot,
	'htdocs/luci-static/resources/view/lpac/settings.js'), 'utf8');

assert.ok(!settingsSource.includes('setDefaultSmdp') &&
	!settingsSource.includes('lpac-default-smdp'),
	'the persistent eUICC default editor must not be mixed into UCI Settings');

[ 'smdp.example.com', 'smdp.example.com:443', '192.0.2.1',
	'[2001:db8::1]:8443', '[::ffff:192.0.2.1]' ].forEach(function(address) {
	assert.strictEqual(actualLpacClient.validSmdpAddress(address), true,
		`${address} should pass shared SM-DP+ host and port validation`);
});
[ '', 'https://smdp.example.com', 'smdp.example.com/path',
	'smdp.example.com:0', 'smdp.example.com:65536', 'bad_host.example.com',
	'[:::]', '[1:2:3:4:5:6:7]', 'rsp.example.com\nsecond',
	'rsp.example.com\n' ].forEach(function(address) {
	assert.strictEqual(actualLpacClient.validSmdpAddress(address), false,
		`${address || '<empty>'} should fail shared SM-DP+ validation`);
});

function pngIcon(width, height) {
	const bytes = Buffer.alloc(24);
	Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ])
		.copy(bytes, 0);
	bytes.write('IHDR', 12, 'ascii');
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);

	return bytes.toString('base64');
}

function jpegIcon(width, height) {
	const bytes = Buffer.alloc(21);

	Buffer.from([ 0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08 ])
		.copy(bytes, 0);
	bytes.writeUInt16BE(height, 7);
	bytes.writeUInt16BE(width, 9);

	return bytes.toString('base64');
}

const safePngIcon = { mime: 'image/png', data: pngIcon(64, 64) };
const safeJpegIcon = { mime: 'image/jpeg', data: jpegIcon(40, 32) };

assert.strictEqual(actualLpacClient.profileIconUri(safePngIcon),
	`data:image/png;base64,${safePngIcon.data}`,
	'a bounded PNG with an exact signature and dimensions should be renderable');
assert.strictEqual(actualLpacClient.profileIconUri(safeJpegIcon),
	`data:image/jpeg;base64,${safeJpegIcon.data}`,
	'a bounded JPEG with an exact signature and dimensions should be renderable');
[
	{ mime: 'image/svg+xml', data: safePngIcon.data },
	{ mime: 'text/html', data: safePngIcon.data },
	{ mime: 'image/png', data: pngIcon(65, 64) },
	{ mime: 'image/jpeg', data: jpegIcon(64, 65) },
	{ mime: 'image/png', data: Buffer.from('not a png').toString('base64') },
	{ mime: 'image/jpeg', data: Buffer.alloc(1025).toString('base64') },
	{ mime: 'image/png', data: '%%%%' }
].forEach(function(icon) {
	assert.strictEqual(actualLpacClient.profileIconUri(icon), null,
		'unsafe, malformed, oversized, or over-dimension profile icons must fall back');
});

const downloadFailureMessage = actualLpacClient.errorMessage({
	success: false,
	error: 'lpac_error',
	reason: 'download_failed',
	code: 255
});
assert.strictEqual(downloadFailureMessage,
	'lpac could not download the profile. Verify the activation details, network connection, and provider service.');
assert.ok(!downloadFailureMessage.includes('255'),
	'a known download failure should not present the unhelpful shell exit status');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'lpac_error',
	code: -1
}), 'lpac rejected the operation.',
'a generic negative sentinel must not be presented as an informative lpac code');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'lpac_error',
	code: 7
}), 'lpac rejected the operation (code 7).',
'a nonnegative lpac code should remain available when no known reason exists');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'job_not_found',
	reason: 'outcome_unknown',
	code: 255
}), 'The profile download outcome is unknown. Refresh Profiles and Notifications before retrying so that the same activation code is not submitted twice.',
	'an unknown outcome should direct the user to inspect state before reusing a one-time code');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'timeout',
	reason: 'preview_timeout'
}), 'The profile preview expired without a decision and was cancelled before installation.',
	'a preview timeout should explicitly state that no installation approval occurred');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'execution_failed',
	reason: 'preview_protocol_error'
}), 'lpac could not complete the protected profile-preview exchange. The profile was not approved for installation.',
	'a pre-accept preview protocol failure should explicitly state that no approval occurred');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'entry_unavailable'
}), 'The discovered order expired or was already used. Run SM-DS discovery again.',
	'the frontend should map the backend capability-safe discovery error exactly');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'lpac_error',
	reason: 'provider_outcome_unknown'
}), 'The provider notification outcome is unknown. Do not send it again automatically; refresh the list and review it first.',
	'an unknown provider outcome should prohibit an automatic retry');
assert.strictEqual(actualLpacClient.errorMessage({
	success: false,
	error: 'lpac_error',
	reason: 'provider_processed_remove_failed'
}), 'The provider accepted the notification, but lpac could not remove its local eUICC record. Use Remove instead of processing it again.',
	'a post-provider removal failure should direct the user to Remove, not Process');

const verificationStorageKey = actualLpacClient.downloadVerificationStorageKey;
const verificationStoragePrefix =
	actualLpacClient.downloadVerificationStoragePrefix;
const verificationProfilesKey = `${verificationStoragePrefix}.profiles`;
const verificationNotificationsKey = `${verificationStoragePrefix}.notifications`;

browserStorage.setItem(verificationStorageKey,
	'{"activation_code":"LPA:1$must-not-survive.example$SECRET"}');
const corruptVerification = actualLpacClient.getDownloadVerification();
assert.strictEqual(corruptVerification.required, true,
	'corrupt verification storage must fail closed');
assert.strictEqual(corruptVerification.pending, false,
	'corrupt storage should be replaced with the post-outcome verification phase');
const repairedMarker = JSON.parse(browserStorage.getItem(verificationStorageKey));
assert.deepStrictEqual(Object.keys(repairedMarker).sort(),
	[ 'generation', 'phase', 'version' ],
	'corrupt storage should be replaced by an allowlisted marker shape');
assert.strictEqual(repairedMarker.version, 1);
assert.strictEqual(repairedMarker.phase, 'verify');
assert.match(repairedMarker.generation, /^[a-z0-9-]{3,80}$/);
assert.ok(!JSON.stringify(repairedMarker).includes('LPA:'),
	'the repaired marker must not retain corrupt credential-like data');
actualLpacClient.markDownloadVerification('profiles');
assert.strictEqual(actualLpacClient.getDownloadVerification().required, true,
	'one successful verification view must not clear a corrupt-state block');
actualLpacClient.markDownloadVerification('notifications');
assert.strictEqual(actualLpacClient.getDownloadVerification().required, false,
	'both successful verification views should clear the repaired state');

browserStorage.clear();
browserStorage.setItem(verificationStoragePrefix,
	'{"version":1,"phase":"verify","activation_code":"SECRET"}');
assert.strictEqual(actualLpacClient.getDownloadVerification().required, true,
	'a legacy single-record state should migrate fail-closed');
assert.strictEqual(browserStorage.getItem(verificationStoragePrefix), null,
	'the legacy record should be removed without parsing or retaining its fields');
assert.ok(!browserStorage.getItem(verificationStorageKey).includes('SECRET'),
	'the migrated marker must not retain arbitrary legacy data');
actualLpacClient.markDownloadVerification('profiles');
actualLpacClient.markDownloadVerification('notifications');

browserStorage.clear();
browserStorage.setItem(verificationProfilesKey, 'orphaned-generation');
assert.strictEqual(actualLpacClient.getDownloadVerification().required, true,
	'an observation without its marker should be treated as corrupt and fail closed');
assert.strictEqual(browserStorage.getItem(verificationProfilesKey), null,
	'orphaned observation storage should be replaced by a clean generation');
actualLpacClient.markDownloadVerification('profiles');
actualLpacClient.markDownloadVerification('notifications');

actualLpacClient.requireDownloadVerification();
actualLpacClient.settleDownloadVerification();
const staleGeneration =
	JSON.parse(browserStorage.getItem(verificationStorageKey)).generation;
actualLpacClient.markDownloadVerification('profiles');
actualLpacClient.markDownloadVerification('notifications');
actualLpacClient.requireDownloadVerification();
actualLpacClient.settleDownloadVerification();
const currentGeneration =
	JSON.parse(browserStorage.getItem(verificationStorageKey)).generation;
assert.notStrictEqual(currentGeneration, staleGeneration,
	'each ambiguity should receive a distinct storage generation');
browserStorage.setItem(verificationProfilesKey, staleGeneration);
browserStorage.setItem(verificationNotificationsKey, staleGeneration);
assert.deepStrictEqual(actualLpacClient.getDownloadVerification(), {
	required: true,
	pending: false,
	profiles: false,
	notifications: false,
	storageAvailable: true
}, 'successful views from an old tab generation must not clear a newer block');
actualLpacClient.markDownloadVerification('profiles');
assert.strictEqual(actualLpacClient.getDownloadVerification().required, true,
	'the current Profiles view should still require current Notifications');
browserStorage.setItem(verificationNotificationsKey, staleGeneration);
assert.strictEqual(actualLpacClient.getDownloadVerification().required, true,
	'a stale Notifications write must not combine with current Profiles');
actualLpacClient.markDownloadVerification('notifications');
assert.strictEqual(actualLpacClient.getDownloadVerification().required, false,
	'only both observations tagged with the current generation should unblock');

actualLpacClient.requireDownloadVerification();
const reloadedLpacClient = loadLpacClient();
assert.deepStrictEqual(reloadedLpacClient.getDownloadVerification(), {
	required: true,
	pending: true,
	profiles: false,
	notifications: false,
	storageAvailable: true
}, 'a fresh frontend module should reload the pending marker from browser storage');
actualLpacClient.settleDownloadVerification();
actualLpacClient.markDownloadVerification('profiles');
actualLpacClient.markDownloadVerification('notifications');

const availableStorage = window.localStorage;

window.localStorage = {
	getItem: function() { throw new Error('storage unavailable'); },
	setItem: function() { throw new Error('storage unavailable'); },
	removeItem: function() { throw new Error('storage unavailable'); }
};
const unavailableLpacClient = loadLpacClient();
assert.deepStrictEqual(unavailableLpacClient.getDownloadVerification(), {
	required: true,
	pending: false,
	profiles: false,
	notifications: false,
	storageAvailable: false
}, 'unavailable browser storage must keep profile downloads fail-closed');
unavailableLpacClient.markDownloadVerification('profiles');
unavailableLpacClient.markDownloadVerification('notifications');
assert.strictEqual(unavailableLpacClient.getDownloadVerification().required, true,
	'an unavailable store must not claim that cross-page verification was retained');
window.localStorage = availableStorage;

function overviewResults(defaultAddress) {
	return [
		{ success: true, data: 'v2.3.0.444' },
		{ success: true, data: { apdu: [ 'uqmi' ], http: [ 'curl' ] } },
		{
			success: true,
			data: {
				eidValue: '89049032000000000000000000000001',
				EuiccConfiguredAddresses: {
					defaultDpAddress: defaultAddress,
					rootDsAddress: 'lpa.ds.gsma.com'
				},
				EUICCInfo2: { extCardResource: {} }
			}
		},
		{ success: true, data: { global: { apdu_backend: 'uqmi' } } }
	];
}

function infoReadback(defaultAddress) {
	return Promise.resolve({
		success: true,
		data: {
			EuiccConfiguredAddresses: { defaultDpAddress: defaultAddress }
		}
	});
}

async function testOverviewDefaultSmdp() {
	const originalAddress = 'old.smdp.example.com';
	const requestedAddress = 'new.smdp.example.com:443';
	const overviewView = loadView('overview.js');
	const overviewPage = overviewView.render(overviewResults(originalAddress));

	documentRoot = overviewPage;
	const edit = document.getElementById('lpac-default-smdp-edit');
	const displayed = document.getElementById('lpac-default-smdp-value');

	assert.ok(edit, 'Overview should expose the default SM-DP+ editor with write permission');
	assert.strictEqual(textContent(displayed), originalAddress,
		'the editable field should remain next to the current eUICC value');
	assert.strictEqual(byText(overviewPage, 'button', 'Change').length, 1,
		'the persistent eUICC editor should not be duplicated in Settings');

	let setCalls = [];
	let readbackCalls = 0;

	lpac.setDefaultSmdp = function(address) {
		setCalls.push(address);
		return Promise.resolve({ success: true, data: null });
	};
	lpac.getInfo = function() {
		readbackCalls++;
		return infoReadback(requestedAddress);
	};
	edit.attrs.click();
	assert.strictEqual(modal.title, 'Change default SM-DP+ address');
	assert.ok(textContent(modal.content).includes(originalAddress),
		'the edit modal should display the old persistent eUICC address');
	assert.ok(textContent(modal.content).includes('persistent state on the eUICC'),
		'the edit modal should distinguish eUICC state from a LuCI setting');
	assert.ok(textContent(modal.content).includes('manual profile download'),
		'the edit modal should explain the effect on manual download without a server');
	const input = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-default-smdp-input';
	})[0];

	assert.strictEqual(input.value, originalAddress,
		'the new-address input should start from the value read from the eUICC');
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	assert.strictEqual(setCalls.length, 0,
		'an unchanged value must not proceed to the persistent mutation');
	assert.ok(textContent(notifications.at(-1).content).includes('different address'));
	input.value = '';
	const noticesBeforeEmpty = notifications.length;
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	assert.strictEqual(setCalls.length, 0,
		'clearing the default address must never reach the RPC');
	assert.strictEqual(input.attrs['aria-invalid'], 'true');
	assert.strictEqual(document.activeElement, input,
		'an empty persistent address should keep focus in the invalid field');
	assert.strictEqual(notifications.length, noticesBeforeEmpty + 1);
	assert.ok(textContent(notifications.at(-1).content).includes('cannot be empty'));

	input.value = 'https://invalid.example.com/path';
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	assert.strictEqual(setCalls.length, 0,
		'a URL or path should be rejected before the persistent-state confirmation');
	assert.ok(textContent(notifications.at(-1).content).includes('valid SM-DP+ host'));
	input.value = 'rsp.example.com\n';
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	assert.strictEqual(setCalls.length, 0,
		'a trailing newline must be rejected explicitly rather than hidden by regex anchoring or trim');

	input.value = requestedAddress;
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	assert.strictEqual(modal.title, 'Confirm persistent SM-DP+ change');
	assert.ok(textContent(modal.content).includes(originalAddress) &&
		textContent(modal.content).includes(requestedAddress),
		'the explicit confirmation should show both old and new addresses');
	assert.ok(textContent(modal.content).includes('writes persistent eUICC state'),
		'the second stage should repeat the persistent-state consequence');
	assert.strictEqual(setCalls.length, 0,
		'reviewing old and new values must not mutate the eUICC');

	await byText(modal.content, 'button', 'Set persistent address')[0].attrs.click();
	assert.deepStrictEqual(setCalls, [ requestedAddress ],
		'the confirmed mutation should send only the validated nonempty address');
	assert.strictEqual(readbackCalls, 1,
		'a successful set response must be followed by one fresh get_info readback');
	assert.strictEqual(textContent(displayed), requestedAddress,
		'the Overview value should change only after matching eUICC readback');
	assert.strictEqual(overviewView.currentDefaultSmdp, requestedAddress);
	assert.strictEqual(notifications.at(-1).level, 'info');
	assert.ok(textContent(notifications.at(-1).content).includes('verified by eUICC readback'));

	const mismatchedRequest = 'requested.smdp.example.com';
	const actualAddress = 'actual.smdp.example.com';

	edit.attrs.click();
	const mismatchInput = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-default-smdp-input';
	})[0];

	assert.ok(textContent(modal.content).includes(requestedAddress),
		'a later edit should use the last verified readback as its old value');
	mismatchInput.value = mismatchedRequest;
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	lpac.getInfo = function() {
		readbackCalls++;
		return infoReadback(actualAddress);
	};
	await byText(modal.content, 'button', 'Set persistent address')[0].attrs.click();
	assert.strictEqual(textContent(displayed), actualAddress,
		'a valid mismatched readback should replace the stale displayed value honestly');
	assert.strictEqual(overviewView.currentDefaultSmdp, actualAddress);
	assert.strictEqual(notifications.at(-1).level, 'warning');
	assert.ok(textContent(notifications.at(-1).content).includes(mismatchedRequest) &&
		textContent(notifications.at(-1).content).includes(actualAddress),
		'a mismatch warning should report requested and actual readback values');
	assert.ok(textContent(notifications.at(-1).content)
		.includes('No successful change is being claimed'));

	const unreadableRequest = 'unreadable.smdp.example.com';

	edit.attrs.click();
	const unreadableInput = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-default-smdp-input';
	})[0];

	unreadableInput.value = unreadableRequest;
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	lpac.getInfo = function() {
		readbackCalls++;
		return Promise.resolve({ success: false, error: 'transport_error' });
	};
	await byText(modal.content, 'button', 'Set persistent address')[0].attrs.click();
	assert.strictEqual(textContent(displayed), actualAddress,
		'a failed readback must not replace the last value actually read from the eUICC');
	assert.strictEqual(notifications.at(-1).level, 'warning');
	assert.ok(textContent(notifications.at(-1).content).includes('readback failed'));

	const failedRequest = 'rejected.smdp.example.com';
	const readbacksBeforeSetFailure = readbackCalls;

	edit.attrs.click();
	const failedInput = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-default-smdp-input';
	})[0];

	failedInput.value = failedRequest;
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	lpac.setDefaultSmdp = function(address) {
		setCalls.push(address);
		return Promise.resolve({ success: false, error: 'lpac_error' });
	};
	await byText(modal.content, 'button', 'Set persistent address')[0].attrs.click();
	assert.strictEqual(readbackCalls, readbacksBeforeSetFailure,
		'a definitive failed set response must not be presented as a successful readback');
	assert.strictEqual(textContent(displayed), actualAddress);
	assert.strictEqual(notifications.at(-1).level, 'error');
	assert.ok(textContent(notifications.at(-1).content)
		.includes('was not confirmed as changed'));

	const ambiguousRequest = 'ambiguous.smdp.example.com';

	edit.attrs.click();
	const ambiguousInput = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-default-smdp-input';
	})[0];

	ambiguousInput.value = ambiguousRequest;
	byText(modal.content, 'button', 'Review change')[0].attrs.click();
	lpac.setDefaultSmdp = function(address) {
		setCalls.push(address);
		return Promise.resolve({ success: false, error: 'transport_error' });
	};
	await byText(modal.content, 'button', 'Set persistent address')[0].attrs.click();
	assert.strictEqual(readbackCalls, readbacksBeforeSetFailure,
		'an ambiguous failed set envelope must not be mislabeled as successful readback');
	assert.strictEqual(textContent(displayed), actualAddress);
	assert.strictEqual(notifications.at(-1).level, 'warning');
	assert.ok(textContent(notifications.at(-1).content)
		.includes('outcome could not be confirmed'));

	ui.hideModal();
	L.hasViewPermission = function() { return false; };
	const readonlyOverview = loadView('overview.js');
	const readonlyPage = readonlyOverview.render(overviewResults(actualAddress));

	documentRoot = readonlyPage;
	assert.strictEqual(findAll(readonlyPage, function(node) {
		return node.attrs?.id === 'lpac-default-smdp-edit';
	}).length, 0, 'read-only Overview must not render a persistent eUICC edit action');
	modal = null;
	const callsBeforeReadonlyProbe = setCalls.length;
	readonlyOverview.showDefaultSmdpModal();
	assert.strictEqual(modal, null,
		'a direct stale handler must not open the mutation modal without write permission');
	assert.strictEqual(setCalls.length, callsBeforeReadonlyProbe,
		'a read-only direct method probe must not call the mutation RPC');
	L.hasViewPermission = function() { return true; };
}

const profile = {
	iccid: '8912345678901234567',
	isdpAid: 'A0000005591010FFFFFFFF8900001000',
	profileState: 'disabled',
	profileNickname: 'Test profile',
	serviceProviderName: 'Test provider',
	icon: safePngIcon
};
const profilesView = loadView('profiles.js');
const profilesPage = profilesView.render({ success: true, data: [ profile ] });
const profileTable = findAll(profilesPage, function(node) {
	return node.attrs?.id === 'lpac-profile-table';
})[0];
assert.ok(profileTable, 'the profile table should have a scoped layout identifier');
assert.ok(profileTable.attrs.class.split(/\s+/).includes('lpac-profile-table'),
	'the profile table should expose its scoped stylesheet class');
assert.strictEqual(findAll(profilesPage, function(node) {
	return node.tag === 'link' && node.attrs?.rel === 'stylesheet' &&
		node.attrs?.href === '/luci-static/resources/view/lpac/profiles.css';
}).length, 1, 'the profile view should load its scoped responsive stylesheet');
const renderedProfileIcon = findAll(profilesPage, function(node) {
	return node.tag === 'img' && node.attrs?.class === 'lpac-profile-icon';
})[0];
const renderedIconFallback = findAll(profilesPage, function(node) {
	return node.attrs?.class === 'lpac-profile-icon lpac-profile-icon-fallback';
})[0];
assert.strictEqual(renderedProfileIcon.attrs.src,
	`data:image/png;base64,${safePngIcon.data}`,
	'a valid normalized profile icon should render only through its fixed image data URI');
assert.strictEqual(renderedProfileIcon.attrs.alt, '',
	'the adjacent profile label should remain the accessible identity for its decorative icon');
assert.strictEqual(renderedIconFallback.style.display, 'none',
	'the fallback should remain hidden while a validated icon loads');
renderedProfileIcon.attrs.error({ currentTarget: renderedProfileIcon });
assert.strictEqual(renderedProfileIcon.style.display, 'none',
	'a browser image decode failure should hide the broken provider icon');
assert.strictEqual(renderedIconFallback.style.display, '',
	'a browser image decode failure should reveal the non-network fallback');

const invalidIconPage = profilesView.render({
	success: true,
	data: [ Object.assign({}, profile, {
		icon: { mime: 'image/svg+xml', data: safePngIcon.data }
	}) ]
});
assert.strictEqual(findAll(invalidIconPage, function(node) {
	return node.tag === 'img' && node.attrs?.class === 'lpac-profile-icon';
}).length, 0, 'an unallowlisted provider icon must never reach an img element');
assert.strictEqual(findAll(invalidIconPage, function(node) {
	return node.attrs?.class === 'lpac-profile-icon lpac-profile-icon-fallback' &&
		node.style.display === '';
}).length, 1, 'an invalid provider icon should use the local fallback');
assert.deepStrictEqual(findAll(profilesPage, function(node) {
	return node.attrs?.class === 'lpac-profile-key';
}).map(textContent), [ 'Profile:', 'Provider:', 'ICCID:', 'State:' ],
	'mobile profile fields should provide inline labels with colons');
const profileActionsHeader = byText(profilesPage, 'th', 'Actions')[0];
assert.ok(profileActionsHeader.attrs.class.split(/\s+/).includes('cbi-section-actions'),
	'the Actions heading should make its generated mobile cell full-width');

[ 'Enable', 'Rename', 'Delete' ].forEach(function(label) {
	const buttons = byText(profilesPage, 'button', label);
	assert.strictEqual(buttons.length, 1, `${label} button should exist`);
	assert.ok(buttons[0].attrs.disabled == null,
		`${label} button must omit the disabled attribute when writable`);
});
const profileActionGroups = findAll(profilesPage, function(node) {
	return node.tag === 'div' && node.attrs?.class === 'lpac-profile-actions' &&
		[ 'Enable', 'Rename', 'Delete' ].every(function(label) {
		return byText(node, 'button', label).length === 1;
	});
});
assert.strictEqual(profileActionGroups.length, 1,
	'profile actions should share one standard action wrapper');
assert.strictEqual(profileActionGroups[0].children.length, 3,
	'the action wrapper should contain only three buttons without spacers');
assert.ok(profileActionGroups[0].children.every(function(node) {
	return node.tag === 'button';
}), 'the clean action row should contain only button elements');
assert.strictEqual(findAll(profilesPage, function(node) {
	return node.tag === 'span' && node.attrs?.class === 'label' &&
		textContent(node) === 'Disabled';
}).length, 1, 'a disabled profile should use the neutral state badge');

const enabledProfile = Object.assign({}, profile, {
	iccid: '8912345678901234568',
	profileState: 'enabled'
});
const enabledProfilesPage = profilesView.render({
	success: true,
	data: [ enabledProfile ]
});
assert.strictEqual(findAll(enabledProfilesPage, function(node) {
	return node.tag === 'span' && node.attrs?.class === 'label success' &&
		textContent(node) === 'Enabled';
}).length, 1, 'an enabled profile should use the standard LuCI success badge');

const disableButtons = byText(enabledProfilesPage, 'button', 'Disable');
assert.strictEqual(disableButtons.length, 1,
	'an enabled profile should retain its Disable action');
assert.ok(disableButtons[0].attrs.disabled == null,
	'the Disable action should be writable for an enabled profile');
assert.ok(byText(enabledProfilesPage, 'button', 'Delete')[0].attrs.disabled != null,
	'an enabled profile must not be deletable');
disableButtons[0].attrs.click();
assert.strictEqual(modal.title, 'Disable profile',
	'Disable should open a confirmation modal before any operation');

const unknownProfile = Object.assign({}, profile, {
	iccid: '8912345678901234569',
	profileState: 'unknown'
});
const unknownProfilesPage = profilesView.render({
	success: true,
	data: [ unknownProfile ]
});
assert.strictEqual(findAll(unknownProfilesPage, function(node) {
	return node.tag === 'span' && node.attrs?.class === 'label warning' &&
		textContent(node) === 'Unknown';
}).length, 1, 'an unknown profile state should use a warning badge');
assert.ok(byText(unknownProfilesPage, 'button', 'Unavailable')[0].attrs.disabled != null,
	'an unknown profile state must not offer a state mutation');

profilesView.showStateModal(profile, true);
assert.ok(modal, 'profile state modal should render');

const refresh = findAll(modal.content, function(node) {
	return node.attrs?.id === 'lpac-profile-refresh';
})[0];
assert.ok(refresh, 'refresh checkbox should exist');
assert.ok(refresh.attrs.checked == null,
	'refresh should be unchecked for the first attempt');
assert.strictEqual(findAll(modal.content, function(node) {
	return node.attrs?.class === 'cbi-value-description' &&
		textContent(node).startsWith('Requests a logical UICC refresh');
}).length, 1, 'refresh help should distinguish the eUICC request from a modem reboot');

[ 'Changing the active profile', 'lpac may create a provider notification' ].forEach(function(text) {
	const notes = findAll(modal.content, function(node) {
		return node.attrs?.class === 'cbi-value-description' &&
			textContent(node).startsWith(text);
	});
	assert.strictEqual(notes.length, 1,
		`${text} guidance should use the standard help-note presentation`);
	assert.strictEqual(notes[0].attrs.role, 'note',
		`${text} guidance should retain explicit note semantics`);
});
assert.strictEqual(findAll(modal.content, function(node) {
	return node.attrs?.class === 'alert-message warning';
}).length, 0, 'profile state guidance should not use oversized warning boxes');

const identifier = findAll(modal.content, function(node) {
	return node.attrs?.id === 'lpac-profile-identifier';
})[0];
assert.ok(identifier, 'identifier selector should exist');
const identifierOptions = findAll(identifier, function(node) {
	return node.tag === 'option';
});
assert.strictEqual(identifierOptions.length, 2,
	'ICCID and ISD-P AID choices should both be offered');
assert.strictEqual(identifierOptions.filter(function(node) {
	return node.attrs.selected != null;
}).length, 1, 'exactly one profile identifier should be selected');

const notificationsView = loadView('notifications.js');
const notificationsPage = notificationsView.render({
	success: true,
	data: [ {
		seqNumber: 0,
		profileManagementOperation: 'enable',
		iccid: profile.iccid,
		notificationAddress: 'example.invalid'
	} ]
});
const removeButtons = byText(notificationsPage, 'button', 'Remove');
assert.strictEqual(removeButtons.length, 1, 'Remove button should exist');
assert.ok(removeButtons[0].attrs.disabled == null,
	'Remove button must omit the disabled attribute for writable sequence zero');
assert.strictEqual(findAll(notificationsPage, function(node) {
	return node.attrs?.class === 'alert-message notice' &&
		textContent(node).includes('verified HTTPS');
}).length, 1, 'the page should state that provider processing uses verified HTTPS');

async function testNotificationProcessing() {
	const originalReload = window.location.reload;
	let reloads = 0;

	window.location.reload = function() { reloads++; };

	const seqZeroView = loadView('notifications.js');
	const seqZeroRecord = {
		seqNumber: 0,
		profileManagementOperation: 'install',
		iccid: profile.iccid,
		notificationAddress: 'notify.example.com'
	};
	const seqZeroPage = seqZeroView.render({ success: true, data: [ seqZeroRecord ] });
	const processCalls = [];

	lpac.processNotification = function(seq, removeAfterSuccess) {
		processCalls.push([ seq, removeAfterSuccess ]);
		return Promise.resolve({ success: true, data: {} });
	};
	byText(seqZeroPage, 'button', 'Process')[0].attrs.click();
	assert.ok(textContent(modal.content).includes('notification sequence 0'),
		`sequence zero should be presented as a real notification, not as missing: ${modal.title} / ${textContent(modal.content)}`);
	const seqZeroRemove = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-notification-remove-after-process';
	})[0];

	seqZeroRemove.checked = true;
	await byText(modal.content, 'button', 'Process')[0].attrs.click();
	assert.deepStrictEqual(processCalls, [ [ '0', true ] ],
		'sequence zero should reach its per-record RPC as canonical text');
	assert.strictEqual(reloads, 1,
		'a successfully processed and removed record should refresh the list once');

	const partialView = loadView('notifications.js');
	const partialRecords = [ 0, 7, 9 ].map(function(seq) {
		return Object.assign({}, seqZeroRecord, { seqNumber: seq });
	});
	const partialPage = partialView.render({ success: true, data: partialRecords });
	const partialCalls = [];

	lpac.processNotification = function(seq, removeAfterSuccess) {
		partialCalls.push([ seq, removeAfterSuccess ]);

		return Promise.resolve(seq === '7'
			? {
				success: false,
				error: 'lpac_error',
				reason: 'provider_outcome_unknown'
			}
			: { success: true, data: {} });
	};
	byText(partialPage, 'button', 'Process all')[0].attrs.click();
	const partialRemove = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-notification-remove-after-process';
	})[0];

	partialRemove.checked = true;
	await byText(modal.content, 'button', 'Process all')[0].attrs.click();
	assert.deepStrictEqual(partialCalls, [ [ '0', true ], [ '7', true ] ],
		'Process all must run sequentially and stop before the record after an unknown outcome');
	assert.strictEqual(partialView.processing, false,
		'notification controls should leave their in-flight state after a stopped batch');
	const partialProcessButtons = byText(partialPage, 'button', 'Process');

	assert.strictEqual(partialProcessButtons[0].disabled, true,
		'a completed record must not be sent again from the stale table');
	assert.strictEqual(partialProcessButtons[1].disabled, true,
		'an unknown provider outcome must not be sent again from the stale table');
	assert.strictEqual(partialProcessButtons[2].disabled, false,
		'a later record that was never attempted should remain available for deliberate per-row processing');
	assert.strictEqual(byText(partialPage, 'button', 'Process all')[0].disabled, true,
		'Process all must stay blocked after a partial or unknown batch result');
	assert.ok(byText(partialPage, 'button', 'Remove').every(function(button) {
		return button.disabled === false;
	}), 'Remove should become available after processing stops, including for a provider-handled record');
	assert.strictEqual(notifications.at(-1).level, 'warning',
		'an unknown provider outcome should remain visible as a warning without reloading');
	assert.ok(textContent(notifications.at(-1).content).includes('1 of 3'),
		'the stopped batch notice should report its exact partial progress');
	assert.strictEqual(reloads, 1,
		'an unknown provider outcome must not immediately reload away its warning');

	for (const ambiguousError of [ 'transport_error', 'timeout', 'execution_failed' ]) {
		const ambiguousView = loadView('notifications.js');
		const ambiguousPage = ambiguousView.render({ success: true, data: [
			Object.assign({}, seqZeroRecord, { seqNumber: 10 })
		] });

		lpac.processNotification = function() {
			return Promise.resolve({ success: false, error: ambiguousError });
		};
		byText(ambiguousPage, 'button', 'Process')[0].attrs.click();
		const ambiguousRemove = findAll(modal.content, function(node) {
			return node.attrs?.id === 'lpac-notification-remove-after-process';
		})[0];

		ambiguousRemove.checked = true;
		await byText(modal.content, 'button', 'Process')[0].attrs.click();
		assert.strictEqual(byText(ambiguousPage, 'button', 'Process')[0].disabled, true,
			`${ambiguousError} must be treated as an unknown provider outcome`);
		assert.strictEqual(notifications.at(-1).level, 'warning',
			`${ambiguousError} after submission should warn against blind resend`);
		assert.ok(textContent(notifications.at(-1).content)
			.includes('do not process this record again automatically'),
			`${ambiguousError} should state the no-resend invariant explicitly`);
	}
	assert.strictEqual(reloads, 1,
		'ambiguous process failures must remain visible instead of triggering a reload');

	const removeFailedView = loadView('notifications.js');
	const removeFailedPage = removeFailedView.render({ success: true, data: [
		Object.assign({}, seqZeroRecord, { seqNumber: 11 })
	] });

	lpac.processNotification = function() {
		return Promise.resolve({
			success: false,
			error: 'lpac_error',
			reason: 'provider_processed_remove_failed'
		});
	};
	byText(removeFailedPage, 'button', 'Process')[0].attrs.click();
	const removeFailedCheckbox = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-notification-remove-after-process';
	})[0];

	removeFailedCheckbox.checked = true;
	await byText(modal.content, 'button', 'Process')[0].attrs.click();
	assert.strictEqual(byText(removeFailedPage, 'button', 'Process')[0].disabled, true,
		'a provider-processed record with failed local removal must not be processed twice');
	assert.strictEqual(byText(removeFailedPage, 'button', 'Remove')[0].disabled, false,
		'a provider-processed record with failed local removal should retain Remove');
	assert.strictEqual(notifications.at(-1).level, 'warning');
	assert.ok(textContent(notifications.at(-1).content)
		.includes('use Remove instead of processing it again'),
		'the failed-removal warning should distinguish known delivery from an unknown outcome');

	const retainedView = loadView('notifications.js');
	const retainedPage = retainedView.render({ success: true, data: [
		Object.assign({}, seqZeroRecord, { seqNumber: 12 })
	] });

	lpac.processNotification = function(seq, removeAfterSuccess) {
		assert.deepStrictEqual([ seq, removeAfterSuccess ], [ '12', false ]);
		return Promise.resolve({ success: true, data: {} });
	};
	byText(retainedPage, 'button', 'Process')[0].attrs.click();
	const retainedRemove = findAll(modal.content, function(node) {
		return node.attrs?.id === 'lpac-notification-remove-after-process';
	})[0];

	retainedRemove.checked = false;
	await byText(modal.content, 'button', 'Process')[0].attrs.click();
	assert.strictEqual(byText(retainedPage, 'button', 'Process')[0].disabled, true,
		'a successfully delivered record intentionally retained on the eUICC must not be resent');
	assert.strictEqual(byText(retainedPage, 'button', 'Remove')[0].disabled, false,
		'a retained successfully delivered record should expose only its Remove path');
	assert.strictEqual(reloads, 1,
		'retaining a processed record should keep the safety state in the current page');

	window.location.reload = originalReload;
}

const settingsView = loadView('settings.js');
const settingsPage = settingsView.render([
	{
		success: true,
		data: {
			global: {
				apdu_backend: 'mbim',
				http_backend: 'curl',
				apdu_debug: '0',
				http_debug: '1',
				custom_isd_r_aid: 'A0000005591010FFFFFFFF8900000100'
			},
			at: { device: '/dev/ttyUSB2', debug: '0' },
			uqmi: { device: '/dev/cdc-wdm0', debug: '0' },
			mbim: { device: '/dev/cdc-wdm0', proxy: '0', skip_slot_mapping: '1' }
		}
	},
	{ success: true, data: { apdu: [ 'mbim', 'at' ], http: [ 'curl' ] } }
]);

function findById(id) {
	return findAll(settingsPage, function(node) { return node.attrs?.id === id; })[0];
}

assert.ok(findById('lpac-apdu-debug').attrs.checked == null,
	'false APDU debug must render unchecked');
assert.ok(findById('lpac-http-debug').attrs.checked != null,
	'true HTTP debug must render checked');
assert.ok(findById('lpac-mbim-proxy').attrs.checked == null,
	'false MBIM proxy must render unchecked');
assert.ok(findById('lpac-mbim-skip-slot-mapping').attrs.checked != null,
	'true MBIM slot-mapping bypass must render checked');

const backend = findById('lpac-apdu-backend');
const backendOptions = findAll(backend, function(node) { return node.tag === 'option'; });
const selectedBackends = backendOptions.filter(function(node) {
	return node.attrs.selected != null;
});
assert.strictEqual(selectedBackends.length, 1,
	'exactly one APDU backend should carry the selected attribute');
assert.strictEqual(selectedBackends[0].attrs.value, 'mbim',
	'the configured APDU backend should be selected');
assert.strictEqual(findAll(settingsPage, function(node) {
	return node.attrs?.class === 'alert-message warning';
}).length, 0, 'inactive backend caveats should not render as page-wide warnings');
assert.strictEqual(findAll(settingsPage, function(node) {
	return node.attrs?.class === 'cbi-value-description' &&
		textContent(node).startsWith('Use the /dev/cdc-wdmN control device');
}).length, 1, 'uqmi device guidance should render as field help');
assert.strictEqual(findAll(settingsPage, function(node) {
	return node.attrs?.class === 'cbi-value-description' &&
		textContent(node).startsWith("Use the modem's currently selected slot");
}).length, 1, 'MBIM slot-mapping guidance should render as field help');
assert.strictEqual(findAll(settingsPage, function(node) {
	return node.attrs?.class === 'cbi-value-description' &&
		textContent(node).startsWith('The AT backend is timing-sensitive');
}).length, 1, 'AT compatibility guidance should render as field help');

const menu = JSON.parse(fs.readFileSync(path.join(appRoot,
	'root/usr/share/luci/menu.d/luci-app-lpac.json'), 'utf8'));
assert.strictEqual(menu['admin/modem'].title, 'Modem',
	'the application should provide the shared Modem menu root');
assert.deepStrictEqual(menu['admin/modem'].depends, {},
	'the shared Modem root must not inherit an application-specific ACL');
assert.strictEqual(menu['admin/modem/lpac'].title, 'eSIM Manager',
	'eSIM Manager should live below the Modem menu');
[ 'overview', 'profiles', 'download', 'notifications', 'settings' ].forEach(function(page) {
	assert.ok(menu[`admin/modem/lpac/${page}`],
		`${page} should remain a child tab below eSIM Manager`);
});
assert.strictEqual(menu['admin/network/lpac'].action.type, 'alias',
	'the former Network path should remain as a hidden compatibility alias');
assert.strictEqual(menu['admin/network/lpac'].action.path, 'admin/modem/lpac',
	'the compatibility alias should target the new Modem path');
assert.strictEqual(menu['admin/network/lpac'].wildcard, true,
	'the compatibility alias should preserve old child-tab URLs');
assert.strictEqual(menu['admin/network/lpac'].title, undefined,
	'the compatibility alias must not remain visible in Network');

const acl = JSON.parse(fs.readFileSync(path.join(appRoot,
	'root/usr/share/rpcd/acl.d/luci-app-lpac.json'), 'utf8'));
const rpcPolicy = acl['luci-app-lpac'];
assert.deepStrictEqual(rpcPolicy.read.ubus['luci.lpac'], [
	'get_version',
	'get_drivers',
	'get_info',
	'list_profiles',
	'list_notifications',
	'get_download_status',
	'get_config'
], 'the read ACL should cover every read-only LuCI RPC');
assert.deepStrictEqual(rpcPolicy.write.ubus['luci.lpac'], [
	'enable_profile',
	'disable_profile',
	'nickname_profile',
	'delete_profile',
	'download_discovered_profile',
	'download_profile',
	'discover_profiles',
	'process_notification',
	'remove_notification',
	'respond_download_preview',
	'set_default_smdp',
	'set_config'
], 'the write ACL should cover every state-changing LuCI RPC');

const profileCss = fs.readFileSync(path.join(appRoot,
	'htdocs/luci-static/resources/view/lpac/profiles.css'), 'utf8');
assert.ok(profileCss.includes('#lpac-profile-table,\n\t#lpac-profile-table > tbody {\n\t\tdisplay: block;'),
	'the responsive layout should not depend on a theme table display mode');
assert.ok(profileCss.includes('#lpac-profile-table .tr.table-titles {\n\t\tdisplay: none;'),
	'the custom responsive grid should hide its redundant table heading');
assert.match(profileCss, /#lpac-profile-table \.tr[^{]+{\s*display: grid;/,
	'the mobile profile rows should use a scoped grid layout');
assert.match(profileCss, /grid-template-columns:\s*minmax\(0, 2fr\) minmax\(7rem, 1fr\)/,
	'the mobile grid should reserve more space for profile names and ICCIDs');
assert.match(profileCss, /#lpac-profile-table \.td\[data-title\][^{]*::before/,
	'the stylesheet should replace only the profile table theme labels');
assert.match(profileCss, /#lpac-profile-table \.td\[data-title\][^{]*::after/,
	'the stylesheet should remove scoped theme decoration from profile cells');
assert.ok(profileCss.includes('\t\tborder-top: 0;'),
	'the responsive grid should suppress theme borders on individual cells');
assert.ok(profileCss.includes('#lpac-profile-table .tr.placeholder > .td {'),
	'the block table should retain a normalized empty-profile placeholder');
assert.match(profileCss, /\.lpac-profile-field[^{]*{[^}]*font-size:\s*1em;/s,
	'profile details should retain the normal table font size on mobile');
assert.match(profileCss, /\.lpac-profile-actions > \.btn[^{]*{[^}]*font-size:\s*13px !important;[^}]*line-height:\s*1\.8em;/s,
	'action buttons should use compact typography without changing their columns');
assert.doesNotMatch(profileCss, /^\s*\.table\s+\.td/m,
	'the responsive override must not alter unrelated LuCI tables');

async function testDownloadView() {
	const decoderPath = path.join(appRoot,
		'htdocs/luci-static/resources/jsqr.min.js');
	const decoderHash = crypto.createHash('sha256')
		.update(fs.readFileSync(decoderPath))
		.digest('hex');

	assert.strictEqual(decoderHash,
		'4d3aa05b4bd0b48d2ae5c399aa931c5a92257c0ef0c50595b49f90dd59a079e0',
		'the audited vendored jsQR asset should retain its exact source hash');

	const decoderAsset = require(decoderPath);
	assert.strictEqual(typeof decoderAsset, 'function',
		'the vendored jsQR asset should expose its decoder function');
	const speedtestCode = 'LPA:1$rsp.truphone.com$QRF-SPEEDTEST';
	const speedtestMatrix = `
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000111111100011011001101011111110000
0000100000101011110100001010000010000
0000101110101001010110101010111010000
0000101110101100101000011010111010000
0000101110100111100110011010111010000
0000100000100001100010101010000010000
0000111111101010101010101011111110000
0000000000001000011100011000000000000
0000100000101000010110010110011100000
0000101001000000001000010101100100000
0000100111110100100111101000001100000
0000111010001010100010110100100100000
0000110010111000011111011010000110000
0000000011000011110010111111100000000
0000111011101010011101000100110000000
0000101010011010111000110011101010000
0000001000111011001111110001001100000
0000111010001001100011110011110100000
0000111011101101011111010101011010000
0000101100001001001010001001010000000
0000100100100011100100001111111010000
0000000000001010110000001000101010000
0000111111100100011111111010101000000
0000100000100110110010011000110110000
0000101110100101010111011111100010000
0000101110100011100010001100000010000
0000101110100100001110111110111100000
0000100000100010010000100100111010000
0000111111101111111100010010111000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000
0000000000000000000000000000000000000`.trim().split('\n');
	const realQR = qrPixels(speedtestMatrix, 4);
	const realDecoded = decoderAsset(realQR.data, realQR.width, realQR.height, {
		inversionAttempts: 'attemptBoth'
	});
	assert.strictEqual(realDecoded?.data, `${speedtestCode}\u2060`,
		'the actual vendored decoder should preserve the trailing U+2060 in the QR payload');

	const initialStatusCalls = [];
	lpac.getDownloadStatus = function(jobId) {
		initialStatusCalls.push(jobId);
		return Promise.resolve({ success: true, data: { status: 'idle' } });
	};

	const initialPollCount = pollEntries.length;
	const downloadView = loadView('download.js');
	const initialStatus = await downloadView.load();
	const downloadPage = downloadView.render(initialStatus);
	documentRoot = downloadPage;
	assert.deepStrictEqual(initialStatusCalls, [ 0 ],
		'the view should query the recoverable current-job status while loading');

	assert.strictEqual(pollEntries.length, initialPollCount + 1,
		'the Download view should register one status poll');
	assert.strictEqual(pollEntries.at(-1).interval, 2,
		'the download status should be polled every two seconds');

	function downloadById(id) {
		return findAll(downloadPage, function(node) {
			return node.attrs?.id === id;
		})[0];
	}

	function completeDownloadVerification(targetView) {
		profilesView.render({ success: true, data: [] });
		notificationsView.render({ success: true, data: [] });
		targetView.syncVerificationRequired(true);
	}

	[
		'lpac-download-mode', 'lpac-activation-code', 'lpac-qr-file',
		'lpac-qr-camera', 'lpac-qr-file-button', 'lpac-qr-camera-button',
		'lpac-smdp', 'lpac-smds', 'lpac-matching-id',
		'lpac-confirmation-code', 'lpac-imei', 'lpac-discovery-results',
		'lpac-download-clear', 'lpac-download-button',
		'lpac-download-progress', 'lpac-download-progress-text',
		'lpac-download-verification'
	].forEach(function(id) {
		assert.ok(downloadById(id), `${id} should be rendered`);
	});

	const qrInput = downloadById('lpac-qr-file');
	const qrCamera = downloadById('lpac-qr-camera');
	assert.strictEqual(downloadById('lpac-activation-code').attrs.maxlength, 4352,
		'the DOM should bound raw activation input before linear edge normalization');
	assert.strictEqual(qrInput.attrs.accept, 'image/png,image/jpeg,image/webp',
		'the QR picker should limit uploads to supported image types');
	assert.ok(qrInput.attrs.capture == null,
		'the gallery picker must not force mobile browsers into camera capture');
	assert.strictEqual(qrCamera.attrs.capture, 'environment',
		'the separate camera picker should request the rear camera');
	assert.strictEqual(qrCamera.attrs.accept, qrInput.attrs.accept,
		'the gallery and camera paths should accept the same supported image types');
	assert.strictEqual(typeof qrInput.attrs.change, 'function');
	assert.strictEqual(typeof qrCamera.attrs.change, 'function');
	assert.ok(qrInput.attrs.disabled == null,
		'the QR picker should remain usable with write permission');
	const qrFileButton = downloadById('lpac-qr-file-button');
	const qrCameraButton = downloadById('lpac-qr-camera-button');
	qrFileButton.attrs.click();
	qrCameraButton.attrs.click();
	assert.strictEqual(qrInput.clickCount, 1,
		'the choose-image action should open only the gallery input');
	assert.strictEqual(qrCamera.clickCount, 1,
		'the take-photo action should open only the camera input');
	const tlsNotices = findAll(downloadPage, function(node) {
		return node.attrs?.class === 'alert-message notice' &&
			textContent(node).includes('system CA bundle');
	});
	assert.strictEqual(tlsNotices.length, 1,
		'the Download view should explain the verified provider TLS trust source');
	assert.ok(textContent(tlsNotices[0]).includes('fail closed'),
		'the TLS notice should explain failure for an invalid clock, chain, or hostname');
	assert.strictEqual(downloadById('lpac-download-button').disabled, false,
		'the verified TLS notice should not disable an explicitly requested profile download');

	const mode = downloadById('lpac-download-mode');
	const activationFields = downloadById('lpac-download-activation-fields');
	const manualFields = downloadById('lpac-download-manual-fields');
	const discoveryFields = downloadById('lpac-download-discovery-fields');
	mode.value = 'manual';
	downloadView.updateMode();
	assert.strictEqual(activationFields.style.display, 'none',
		'manual mode should hide activation-code controls');
	assert.strictEqual(manualFields.style.display, '',
		'manual mode should reveal non-interactive lpac parameters');
	assert.strictEqual(discoveryFields.style.display, 'none',
		'manual mode should keep SM-DS discovery controls hidden');

	const smdpInput = downloadById('lpac-smdp');
	const matchingInput = downloadById('lpac-matching-id');
	smdpInput.value = 'smdp.example.com:443';
	matchingInput.value = 'MATCHING-ID';
	assert.deepStrictEqual(downloadView.collectRequest(), {
		mode: 'manual',
		activationCode: '',
		smdp: 'smdp.example.com:443',
		matchingId: 'MATCHING-ID',
		imei: '',
		confirmationCode: ''
	}, 'manual mode should preserve lpac SM-DP+ and matching-ID arguments');
	matchingInput.value = '';
	assert.strictEqual(downloadView.collectRequest().matchingId, '',
		'manual mode should allow the optional matching ID to be empty');
	matchingInput.value = 'INVALID/MATCHING-ID';
	assert.throws(function() { downloadView.collectRequest(); },
		/The matching ID is invalid/,
		'a nonempty manual matching ID should retain strict validation');
	matchingInput.value = 'MATCHING-ID';
	smdpInput.value = '[2001:db8::1]:65535';
	assert.strictEqual(downloadView.collectRequest().smdp, '[2001:db8::1]:65535',
		'the frontend should accept the bracketed IPv6 form accepted by the RPC');
	[ '[::1]', '[1:2:3:4:5:6:7:8]', '[::ffff:192.0.2.1]:443' ]
		.forEach(function(value) {
			smdpInput.value = value;
			assert.strictEqual(downloadView.collectRequest().smdp, value,
				`${value} should pass strict bracketed IPv6 validation`);
		});
	[ 'smdp.example.com:0', 'smdp.example.com:65536',
		'smdp.example.com/path', '[:::]', '[1:2:3:4:5:6:7]',
		'[1:2:3:4:5:6:7:8:9]', 'rsp.example.com\nsecond',
		'rsp.example.com\n' ].forEach(function(value) {
		smdpInput.value = value;
		assert.throws(function() { downloadView.collectRequest(); },
			/The SM-DP\+ address is invalid/,
			`${value} should be rejected before invoking the RPC`);
	});
	smdpInput.value = 'smdp.example.com:443';

	mode.value = 'discovery';
	downloadView.updateMode();
	assert.strictEqual(activationFields.style.display, 'none',
		'SM-DS mode should hide activation-code and QR controls');
	assert.strictEqual(manualFields.style.display, 'none',
		'SM-DS mode should hide manual download parameters');
	assert.strictEqual(discoveryFields.style.display, '',
		'SM-DS mode should reveal discovery controls');
	assert.strictEqual(textContent(downloadById('lpac-download-button')), 'Discover profiles',
		'the primary action should describe discovery before any download starts');
	const smdsInput = downloadById('lpac-smds');
	const imeiInput = downloadById('lpac-imei');
	const discoveryCalls = [];
	const firstEntryId = 'A'.repeat(32);
	const secondEntryId = 'B'.repeat(32);

	smdsInput.value = 'discovery.example.com:443';
	imeiInput.value = '490154203237518';
	lpac.discoverProfiles = function(smds, imei) {
		discoveryCalls.push([ smds, imei ]);
		return Promise.resolve({
			success: true,
			data: [
				{ entry_id: firstEntryId, smdp: 'first.smdp.example.com' },
				{ entry_id: secondEntryId, smdp: 'second.smdp.example.com:8443' }
			]
		});
	};
	await downloadView.handlePrimaryAction();
	assert.deepStrictEqual(discoveryCalls,
		[ [ 'discovery.example.com:443', '490154203237518' ] ],
		'SM-DS mode should pass only the validated discovery address and optional IMEI');
	assert.strictEqual(downloadView.discoveryEntries.length, 2,
		'all validated opaque discovery results should remain available in this tab');
	assert.ok(textContent(downloadById('lpac-discovery-results'))
		.includes('first.smdp.example.com'),
		'discovery results should identify the non-secret SM-DP+ destination');
	assert.ok(!textContent(downloadById('lpac-discovery-results')).includes(firstEntryId),
		'the opaque discovery capability must not be rendered into page text');
	assert.ok(!textContent(downloadById('lpac-discovery-results')).includes('eventId'),
		'no SM-DS EventID field should be exposed in the discovery DOM');
	assert.strictEqual(byText(downloadById('lpac-discovery-results'),
		'button', 'Review profile').length, 2,
		'each discovered order should expose a direct preview action');

	const discoveryConfirmation = 'DISCOVERY-CONFIRMATION';
	downloadById('lpac-confirmation-code').value = discoveryConfirmation;
	byText(downloadById('lpac-discovery-results'),
		'button', 'Review profile')[0].attrs.click();
	assert.strictEqual(modal.title, 'Review discovered profile');
	assert.ok(!textContent(modal.content).includes(firstEntryId),
		'the discovery capability should not be echoed in its start confirmation');
	assert.ok(!textContent(modal.content).includes(discoveryConfirmation),
		'the discovery confirmation secret should not be echoed in its start confirmation');
	const discoveryDownloadCalls = [];
	const discoveryDecisionToken = 'D'.repeat(32);

	lpac.downloadDiscoveredProfile = function(entryId, confirmationCode) {
		discoveryDownloadCalls.push([ entryId, confirmationCode ]);
		return Promise.resolve({
			success: true,
			data: {
				job_id: 11,
				status: 'running',
				phase: 'authenticating',
				decision_token: discoveryDecisionToken
			}
		});
	};
	await byText(modal.content, 'button', 'Retrieve preview')[0].attrs.click();
	assert.deepStrictEqual(discoveryDownloadCalls,
		[ [ firstEntryId, discoveryConfirmation ] ],
		'a discovered order should start directly from its opaque entry capability');
	assert.strictEqual(downloadView.activeJobOrigin, 'owned',
		'a discovered preview start with its decision token should belong only to this tab');
	assert.strictEqual(downloadView.activeDecisionToken, discoveryDecisionToken,
		'the owned discovery session should retain its unrendered decision token');
	assert.strictEqual(downloadView.discoveryEntries.length, 0,
		'a claimed discovery capability should leave the browser result list immediately');
	assert.strictEqual(modal, null,
		'authentication should remain inline until the provider preview becomes available');

	lpac.getDownloadStatus = function(jobId, decisionToken) {
		assert.deepStrictEqual([ jobId, decisionToken ],
			[ 11, discoveryDecisionToken ]);
		return Promise.resolve({
			success: true,
			data: {
				job_id: 11,
				status: 'running',
				phase: 'awaiting_confirmation',
				preview: null
			}
		});
	};
	await downloadView.pollDownload();
	assert.strictEqual(modal.title, 'Review eSIM profile',
		'a provider that omits metadata must still reach a mandatory decision dialog');
	assert.ok(textContent(modal.content).includes('did not supply profile metadata'),
		'a null preview should clearly disclose that the profile identity is unavailable');
	assert.ok(textContent(modal.content).includes('first.smdp.example.com'),
		'the null preview should retain the non-secret SM-DP+ context from discovery');
	assert.ok(byText(modal.content, 'button', 'Install without metadata')[0],
		'installing a null-metadata preview should require an explicit, accurately named action');
	assert.ok(!textContent(modal.content).includes(discoveryDecisionToken),
		'the preview decision token must never be rendered');
	assert.ok(!browserStorage.getItem(verificationStorageKey)
		.includes(discoveryDecisionToken),
		'the preview decision token must never enter persistent verification storage');
	const discoveryDecisionCalls = [];

	lpac.respondDownloadPreview = function(jobId, decisionToken, accept) {
		discoveryDecisionCalls.push([ jobId, decisionToken, accept ]);
		return Promise.resolve({ success: true, data: {} });
	};
	lpac.getDownloadStatus = function(jobId, decisionToken) {
		assert.deepStrictEqual([ jobId, decisionToken ],
			[ 11, discoveryDecisionToken ]);
		return Promise.resolve({
			success: true,
			data: { job_id: 11, status: 'cancelled', phase: 'cancelled' }
		});
	};
	await byText(modal.content, 'button', 'Cancel download')[0].attrs.click();
	assert.deepStrictEqual(discoveryDecisionCalls,
		[ [ 11, discoveryDecisionToken, false ] ],
		'cancelling the null preview should send one owned rejection and no approval');
	assert.strictEqual(downloadView.activeJob, null,
		'a rejected discovered preview should terminate without installation');
	assert.strictEqual(downloadView.retryBlocked, false,
		'a confirmed pre-install cancellation should remain safe for a new request');

	downloadView.clearForm();

	mode.value = 'activation';
	downloadView.updateMode();
	assert.strictEqual(activationFields.style.display, '',
		'activation mode should restore activation-code controls');
	assert.strictEqual(manualFields.style.display, 'none',
		'activation mode should hide manual controls');
	const activationInput = downloadById('lpac-activation-code');
	activationInput.value = 'LPA:1$smdp.example.com$';
	assert.strictEqual(downloadView.collectRequest().activationCode,
		'LPA:1$smdp.example.com$',
		'an upstream activation code may omit its matching ID');
	activationInput.value = `${speedtestCode}\u2060`;
	assert.strictEqual(downloadView.collectRequest().activationCode, speedtestCode,
		'a harmless trailing U+2060 copied with the Speedtest code should be removed');
	assert.strictEqual(activationInput.value, speedtestCode,
		'the normalized activation code should replace the pasted DOM value');
	activationInput.value = `${' \u2060'.repeat(64)}${speedtestCode}${'\u2060 '.repeat(64)}`;
	assert.strictEqual(downloadView.collectRequest().activationCode, speedtestCode,
		'mixed whitespace and format marks at both edges should normalize in one bounded pass');
	activationInput.value = `LPA:1$smdp.example.com$${'A'.repeat(4353)}`;
	assert.throws(function() { downloadView.collectRequest(); },
		/Enter a valid LPA:1/,
		'raw activation input above the explicit normalization cap must be rejected');
	activationInput.value = 'LPA:1$smdp.example.com$MATCH$OID$';
	assert.strictEqual(downloadView.collectRequest().activationCode,
		'LPA:1$smdp.example.com$MATCH$OID',
		'an empty optional fifth field should be removed for lpac 2.3.0 compatibility');
	assert.strictEqual(activationInput.value, 'LPA:1$smdp.example.com$MATCH$OID',
		'the canonical four-field form should replace the ambiguous pasted value');
	activationInput.value = 'LPA:1$rsp.truphone.com$QRF-\u2060SPEEDTEST';
	assert.throws(function() { downloadView.collectRequest(); },
		/Enter a valid LPA:1/,
		'an invisible formatting character inside the matching ID must remain invalid');

	activationInput.value = 'LPA:1$smdp.example.com$MATCHING-ID$$1';
	downloadById('lpac-confirmation-code').value = '';
	assert.throws(function() { downloadView.collectRequest(); },
		/requires a confirmation code/,
		'a confirmation-required activation code should identify its missing input');
	const notificationCountBeforeConfirmation = notifications.length;
	downloadView.showDownloadModal();
	assert.strictEqual(notifications.length, notificationCountBeforeConfirmation + 1,
		'the missing confirmation code should produce one validation notification');
	assert.strictEqual(downloadById('lpac-confirmation-code').attrs['aria-invalid'], 'true',
		'the missing confirmation code should mark the responsible field invalid');
	assert.strictEqual(document.activeElement, downloadById('lpac-confirmation-code'),
		'the missing confirmation code should focus the responsible field');
	downloadById('lpac-confirmation-code').value = '1234';
	assert.strictEqual(downloadView.collectRequest().confirmationCode, '1234',
		'a confirmation-required activation code should pass once its code is supplied');
	downloadById('lpac-confirmation-code').value = '';

	let decoderCalls = 0;
	let qrPayload = 'lpa:1$qr.example.com$';
	let imageWidth = 320;
	let imageHeight = 240;
	const localDecoder = function(data, width, height, options) {
		decoderCalls++;
		assert.ok(data instanceof Uint8ClampedArray,
			'the local decoder should receive browser pixel data');
		assert.strictEqual(width, 320);
		assert.strictEqual(height, 240);
		assert.strictEqual(options.inversionAttempts, 'attemptBoth');
		return { data: qrPayload };
	};
	window.FileReader = function() {};
	window.FileReader.prototype.readAsDataURL = function() {
		this.result = 'data:image/png;base64,AA==';
		this.onload();
	};
	window.Image = function() {
		this.naturalWidth = imageWidth;
		this.naturalHeight = imageHeight;
	};
	Object.defineProperty(window.Image.prototype, 'src', {
		get: function() { return this.imageSource; },
		set: function(value) {
			this.imageSource = value;
			this.onload();
		}
	});
	delete window.jsQR;
	const scriptCountBeforeQRLoad = appendedScripts.length;
	scriptAppendHandler = function(script) {
		window.jsQR = function() { return null; };
		script.onload();
	};
	qrInput.files = [ { type: 'image/png', size: 1024 } ];
	await downloadView.handleQRFile(qrInput);
	scriptAppendHandler = null;
	assert.strictEqual(appendedScripts.length, scriptCountBeforeQRLoad + 1,
		'the first QR image should lazily append exactly one decoder script');
	const decoderScript = appendedScripts.at(-1);
	assert.strictEqual(decoderScript.src, '/luci-static/resources/jsqr.min.js',
		'the browser loader should use the packaged LuCI resource path');
	assert.strictEqual(decoderScript.async, true,
		'the local decoder script should not block the LuCI page parser');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'No valid eSIM activation code was found in the image.',
		'the simulated browser-global decoder should complete the lazy-load path');
	downloadView.clearForm();

	window.jsQR = decoderAsset;
	canvasFixture = realQR;
	imageWidth = realQR.width;
	imageHeight = realQR.height;
	qrCamera.files = [ { type: 'image/png', size: 1024 } ];
	await qrCamera.attrs.change({ currentTarget: qrCamera });
	assert.strictEqual(activationInput.value, speedtestCode,
		'the camera path should decode the real Speedtest QR matrix with vendored jsQR');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'QR code decoded. The activation-code field has been filled.');
	downloadView.clearForm();
	canvasFixture = null;
	imageWidth = 320;
	imageHeight = 240;
	window.jsQR = localDecoder;

	qrInput.files = [ { type: 'application/pdf', size: 1024 } ];
	await downloadView.handleQRFile(qrInput);
	assert.strictEqual(decoderCalls, 0,
		'an explicitly unsupported MIME type should not reach the image decoder');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'Select a PNG, JPEG, or WebP image.');

	qrInput.files = [ { type: 'image/png', size: 8 * 1024 * 1024 + 1 } ];
	await downloadView.handleQRFile(qrInput);
	assert.strictEqual(decoderCalls, 0,
		'an oversized QR file should be rejected before image decoding');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'The QR image must not exceed 8 MiB.');

	imageWidth = 7000;
	imageHeight = 6000;
	qrInput.files = [ { type: 'image/jpeg', size: 1024 } ];
	await downloadView.handleQRFile(qrInput);
	assert.strictEqual(decoderCalls, 0,
		'an image above the pixel cap should not reach the QR decoder');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'The QR image dimensions are invalid or too large.');
	imageWidth = 320;
	imageHeight = 240;

	qrInput.files = [ { type: '', size: 1024 } ];
	await downloadView.handleQRFile(qrInput);
	assert.strictEqual(decoderCalls, 1,
		'an image with an unspecified browser MIME type should still be decoded locally');
	assert.strictEqual(downloadById('lpac-activation-code').value,
		'LPA:1$qr.example.com$',
		'a QR without a matching ID should be normalized into the activation field');
	assert.strictEqual(downloadById('lpac-qr-preview').src,
		'data:image/png;base64,AA==',
		'the selected QR should receive a local data-URL preview');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'QR code decoded. The activation-code field has been filled.');
	assert.strictEqual(downloadById('lpac-confirmation-code').value, '',
		'an optional confirmation code should remain empty after decoding');

	window.jsQR = function() { return null; };
	qrInput.files = [ { type: 'image/png', size: 2048 } ];
	await downloadView.handleQRFile(qrInput);
	assert.strictEqual(downloadById('lpac-activation-code').value, '',
		'a failed replacement QR must clear the previously decoded activation code');
	assert.strictEqual(downloadById('lpac-qr-preview').src, undefined,
		'a failed replacement QR must clear the previous local preview');
	assert.strictEqual(downloadById('lpac-qr-preview').style.display, 'none');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'No valid eSIM activation code was found in the image.');
	assert.strictEqual(downloadById('lpac-qr-status').attrs.role, 'alert',
		'a QR decoding error should be announced as an alert');

	let finishDelayedRead = null;
	let staleDecoderCalls = 0;
	window.FileReader.prototype.readAsDataURL = function() {
		const reader = this;

		finishDelayedRead = function() {
			reader.result = 'data:image/png;base64,DELAYED';
			reader.onload();
		};
	};
	window.jsQR = function() {
		staleDecoderCalls++;
		return { data: 'LPA:1$stale.example.com$STALE' };
	};
	activationInput.value = speedtestCode;
	qrCamera.files = [ { type: 'image/jpeg', size: 2048 } ];
	const delayedDecode = downloadView.handleQRFile(qrCamera);
	assert.strictEqual(downloadView.qrDecoding, true,
		'the view should expose an in-progress QR decode state');
	assert.strictEqual(downloadById('lpac-download-button').disabled, true,
		'profile download must be disabled while a QR image is still decoding');
	assert.strictEqual(typeof activationInput.attrs.input, 'function',
		'the activation field should listen for edits that supersede a pending QR');
	activationInput.value = 'LPA:1$manual.example.com$MANUAL';
	activationInput.attrs.input({ currentTarget: activationInput });
	assert.strictEqual(downloadView.qrDecoding, false,
		'a manual activation-code edit should cancel the pending QR result');
	assert.strictEqual(downloadById('lpac-download-button').disabled, false,
		'the Download action should be restored after the manual edit wins the race');
	finishDelayedRead();
	await delayedDecode;
	assert.strictEqual(staleDecoderCalls, 0,
		'a superseded image should not consume CPU in the QR decoder');
	assert.strictEqual(activationInput.value, 'LPA:1$manual.example.com$MANUAL',
		'a stale delayed QR result must not overwrite a newer manual activation code');

	window.FileReader.prototype.readAsDataURL = function() {
		this.result = 'data:image/png;base64,AA==';
		this.onload();
	};

	qrPayload = 'lpa:1$qr.example.com$QR-MATCHING-ID$$1';
	window.jsQR = localDecoder;
	qrInput.files = [ { type: 'image/png', size: 1024 } ];
	await downloadView.handleQRFile(qrInput);
	assert.strictEqual(downloadById('lpac-activation-code').value,
		'LPA:1$qr.example.com$QR-MATCHING-ID$$1',
		'a valid replacement QR should restore the newly decoded code');
	assert.strictEqual(downloadById('lpac-confirmation-code').value, '',
		'a QR requiring confirmation should decode before its code is entered');

	downloadById('lpac-confirmation-code').value = '1234';
	downloadById('lpac-imei').value = '490154203237518';
	let downloadArguments = null;
	let resolveDownloadStart = null;
	lpac.downloadProfile = function() {
		downloadArguments = Array.from(arguments);
		return new Promise(function(resolve) {
			resolveDownloadStart = resolve;
		});
	};

	downloadView.showDownloadModal();
	assert.strictEqual(modal.title, 'Review eSIM profile',
		'the preview session should require confirmation before invoking lpac');
	assert.ok(!textContent(modal.content).includes('QR-MATCHING-ID'),
		'the confirmation dialog should not echo the activation secret');
	assert.ok(!textContent(modal.content).includes('1234'),
		'the confirmation dialog should not echo the confirmation code');

	const confirmButton = byText(modal.content, 'button', 'Retrieve preview')[0];
	assert.ok(confirmButton,
		'the first confirmation should start only the authenticated preview session');
	const starting = confirmButton.attrs.click();
	assert.strictEqual(downloadView.downloadStarting, true,
		'the view should record the in-flight start request');
	const startingModal = modal;
	downloadView.showDownloadModal();
	assert.strictEqual(modal, startingModal,
		'a repeated click while starting must not replace the progress modal');
	await Promise.resolve();
	assert.strictEqual(typeof resolveDownloadStart, 'function',
		'the confirmed preview request should invoke the download start RPC once');
	const ownedDecisionToken = 'T'.repeat(32);

	resolveDownloadStart({
		success: true,
		data: {
			job_id: 17,
			status: 'running',
			phase: 'authenticating',
			decision_token: ownedDecisionToken
		}
	});
	await starting;
	assert.deepStrictEqual(downloadArguments, [
		'activation', 'LPA:1$qr.example.com$QR-MATCHING-ID$$1', '', '',
		'490154203237518', '1234'
	], 'the browser should pass the complete activation code and optional flags');
	assert.strictEqual(downloadView.activeJob, 17,
		'the returned asynchronous job identifier should be retained');
	assert.strictEqual(downloadView.activeJobOrigin, 'owned',
		'a job identifier returned by this start request should be owned by the form');
	assert.strictEqual(downloadView.activeDecisionToken, ownedDecisionToken,
		'an owned job must retain the mandatory one-time decision token');
	assert.strictEqual(downloadView.activePhase, 'authenticating',
		'a new provider session should begin in the exact backend authentication phase');
	assert.strictEqual(modal, null,
		'the short start modal should close after the background job is attached');
	assert.strictEqual(downloadById('lpac-download-progress').style.display, '',
		'the UI should retain inline progress while lpac runs');
	assert.strictEqual(downloadById('lpac-download-button').disabled, true,
		'the active job should disable duplicate download attempts');
	downloadView.showDownloadModal();
	assert.strictEqual(modal, null,
		'a repeated click for an active job must not open a second confirmation modal');

	const metadataPreview = {
		profileName: 'Speedtest profile',
		serviceProviderName: 'Test provider',
		iccid: '8944500102198099736',
		profileClass: 'testing',
		icon: safeJpegIcon
	};
	lpac.getDownloadStatus = function(jobId, decisionToken) {
		assert.deepStrictEqual([ jobId, decisionToken ], [ 17, ownedDecisionToken ]);
		return Promise.resolve({
			success: true,
			data: {
				job_id: 17,
				status: 'running',
				phase: 'awaiting_confirmation',
				preview: metadataPreview
			}
		});
	};
	await downloadView.pollDownload();
	assert.strictEqual(modal.title, 'Review eSIM profile',
		'provider metadata should open the mandatory second-stage decision dialog');
	[ 'Speedtest profile', 'Test provider', '8944500102198099736', 'testing' ]
		.forEach(function(value) {
			assert.ok(textContent(modal.content).includes(value),
				`the owned preview should display normalized metadata: ${value}`);
		});
	const previewIcon = findAll(modal.content, function(node) {
		return node.tag === 'img' && node.attrs?.src ===
			`data:image/jpeg;base64,${safeJpegIcon.data}`;
	})[0];
	const previewIconFallback = findAll(modal.content, function(node) {
		return node.attrs?.class === 'lpac-preview-icon-fallback';
	})[0];

	assert.ok(previewIcon,
		'the preview should reuse the bounded PNG/JPEG icon validator');
	assert.strictEqual(previewIconFallback.style.display, 'none',
		'the neutral preview fallback should start hidden for a validated icon');
	previewIcon.attrs.error({ currentTarget: previewIcon });
	assert.strictEqual(previewIcon.style.display, 'none',
		'a browser decode failure should hide a truncated or CRC-invalid preview icon');
	assert.strictEqual(previewIconFallback.style.display, 'inline-block',
		'a browser decode failure should reveal the neutral preview icon fallback');
	assert.ok(!textContent(modal.content).includes('QR-MATCHING-ID') &&
		!textContent(modal.content).includes('1234') &&
		!textContent(modal.content).includes(ownedDecisionToken),
		'the metadata dialog must not echo activation, confirmation, or decision secrets');
	assert.strictEqual(byText(modal.content, 'button', 'Install profile').length, 1,
		'metadata retrieval alone must never install without a second explicit click');
	const previewDecisionCalls = [];

	lpac.respondDownloadPreview = function(jobId, decisionToken, accept) {
		previewDecisionCalls.push([ jobId, decisionToken, accept ]);
		return Promise.resolve({ success: false, error: 'transport_error' });
	};
	lpac.getDownloadStatus = function(jobId, decisionToken) {
		assert.deepStrictEqual([ jobId, decisionToken ], [ 17, ownedDecisionToken ]);
		return Promise.resolve({
			success: true,
			data: {
				job_id: 17,
				status: 'running',
				phase: 'awaiting_confirmation',
				preview: metadataPreview
			}
		});
	};
	await byText(modal.content, 'button', 'Install profile')[0].attrs.click();
	assert.deepStrictEqual(previewDecisionCalls,
		[ [ 17, ownedDecisionToken, true ] ],
		'an explicit installation decision should send its owned token exactly once');
	assert.strictEqual(modal, null,
		'a lost approval response must not reopen a dialog that could resend approval');
	assert.strictEqual(downloadView.previewDecisionSent, true,
		'a lost approval response should remain one-shot while status polling resolves it');
	await downloadView.pollDownload();
	assert.deepStrictEqual(previewDecisionCalls,
		[ [ 17, ownedDecisionToken, true ] ],
		'continued awaiting status must never trigger an automatic or duplicate approval');

	const statuses = [
		{ success: false, error: 'transport_error' },
		{ success: false, error: 'transport_error' },
		{},
		{ success: true, data: { status: 'idle' } },
		{
			success: true,
			data: { job_id: 17, status: 'running', phase: 'installing' }
		},
		{ success: true, data: { job_id: 17, status: 'success', phase: 'complete' } }
	];
	const polledJobs = [];
	let rejectFirstPoll = true;
	lpac.getDownloadStatus = function(jobId, decisionToken) {
		polledJobs.push([ jobId, decisionToken ]);

		if (rejectFirstPoll) {
			rejectFirstPoll = false;
			return Promise.reject(new Error('temporary RPC failure'));
		}

		return Promise.resolve(statuses.shift());
	};
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, 17,
		'a rejected status request should not abandon the running backend task');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, 17,
		'a transport error should not abandon the running backend task');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, 17,
		'repeated transport errors should still retain the supervised backend task');
	assert.strictEqual(textContent(downloadById('lpac-download-progress-text')),
		'Connection to the lpac service was lost. The download may still be running; status checks will continue automatically.',
		'three consecutive status failures should make the uncertain connection visible');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, 17,
		'a malformed status must not be treated as terminal');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, 17,
		'an idle status is invalid for a specific running job and must not enable retry');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, 17,
		'a canonical running status should retain the download and recover polling');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, null,
		'a completed download should leave the active state');
	assert.deepStrictEqual(polledJobs,
		Array(7).fill([ 17, ownedDecisionToken ]),
		'all owned status polls should retain the exact tab-scoped decision token');
	assert.strictEqual(downloadById('lpac-activation-code').value, '',
		'the activation secret should be cleared after success');
	assert.strictEqual(downloadById('lpac-confirmation-code').value, '',
		'the confirmation code should be cleared after success');
	assert.strictEqual(downloadById('lpac-imei').value, '',
		'the optional IMEI should be cleared after success');
	assert.strictEqual(downloadById('lpac-qr-preview').style.display, 'none',
		'the local QR preview should be cleared after success');
	assert.strictEqual(downloadById('lpac-download-progress').style.display, 'none',
		'the persistent progress notice should hide after terminal success');
	assert.strictEqual(downloadById('lpac-download-button').disabled, false,
		'the Download action should be restored after terminal success');
	assert.strictEqual(notifications.at(-1).level, 'info',
		'a successful profile download should produce an information notice');

	const decisionsBeforeMissingToken = previewDecisionCalls.length;
	lpac.downloadProfile = function() {
		return Promise.resolve({
			success: true,
			data: {
				job_id: 18,
				status: 'running',
				phase: 'awaiting_confirmation',
				preview: metadataPreview
			}
		});
	};
	await downloadView.startDownload({
		mode: 'activation',
		activationCode: 'LPA:1$missing-token.example.com$TOKENLESS',
		smdp: '',
		matchingId: '',
		imei: '',
		confirmationCode: ''
	});
	assert.strictEqual(downloadView.activeJobOrigin, 'uncertain',
		'a start response without its mandatory decision token must not be owned');
	assert.strictEqual(downloadView.activeDecisionToken, null,
		'a missing decision token must never be synthesized or recovered publicly');
	assert.strictEqual(modal, null,
		'metadata without an owned decision token must not expose an approval action');
	assert.strictEqual(downloadView.retryBlocked, true,
		'a malformed tokenless start should require state verification before retry');
	lpac.getDownloadStatus = function(jobId, decisionToken) {
		assert.deepStrictEqual([ jobId, decisionToken ], [ 18, '' ],
			'a tokenless job may be monitored only through sanitized public status');
		return Promise.resolve({
			success: true,
			data: { job_id: 18, status: 'cancelled', phase: 'cancelled' }
		});
	};
	await downloadView.pollDownload();
	assert.strictEqual(previewDecisionCalls.length, decisionsBeforeMissingToken,
		'a tokenless preview must time out or cancel without any frontend approval RPC');
	assert.strictEqual(downloadView.activeJob, null,
		'a publicly observed tokenless cancellation should end monitoring safely');
	completeDownloadVerification(downloadView);
	assert.strictEqual(downloadView.retryBlocked, false,
		'Profiles and Notifications verification should unblock after tokenless cancellation');

	activationInput.value = 'LPA:1$unsent.example.com$UNSENT';
	lpac.downloadProfile = function() {
		return Promise.resolve({ success: false, error: 'busy' });
	};
	lpac.getDownloadStatus = function(jobId) {
		return Promise.resolve({
			success: true,
			data: { job_id: jobId === 0 ? 21 : jobId, status: 'running' }
		});
	};
	await downloadView.startDownload({
		mode: 'activation',
		activationCode: 'LPA:1$second.example.com$SECOND',
		smdp: '',
		matchingId: '',
		imei: '',
		confirmationCode: ''
	});
	assert.strictEqual(downloadView.activeJob, 21,
		'a busy response should monitor the existing download when it is discoverable');
	assert.strictEqual(downloadView.activeJobOrigin, 'external',
		'the existing download must not be attributed to the rejected form submission');
	assert.strictEqual(activationInput.value, 'LPA:1$unsent.example.com$UNSENT',
		'monitoring an existing download must preserve the unsent activation code');
	assert.ok(textContent(downloadById('lpac-download-progress-text')).includes('Another'),
		'the progress text should identify an existing download rather than this form');
	lpac.getDownloadStatus = function(jobId) {
		return Promise.resolve({ success: true, data: { job_id: jobId, status: 'success' } });
	};
	await downloadView.pollDownload();
	assert.strictEqual(activationInput.value, 'LPA:1$unsent.example.com$UNSENT',
		'the existing job completion must not clear credentials that were never submitted');
	assert.ok(textContent(notifications.at(-1).content).includes('form was not submitted'),
		'the terminal notice should distinguish the monitored job from the unsent form');
	assert.strictEqual(downloadView.retryBlocked, false,
		'an explicitly rejected busy request must remain safe to retry after the external job');
	assert.strictEqual(downloadById('lpac-download-button').disabled, false,
		'the form should be restored after the external job reaches a terminal state');

	lpac.downloadProfile = function() {
		return Promise.resolve({ success: false, error: 'busy' });
	};
	lpac.getDownloadStatus = function() {
		return Promise.resolve({ success: true, data: { status: 'idle' } });
	};
	await downloadView.startDownload({
		mode: 'activation',
		activationCode: 'LPA:1$second.example.com$SECOND',
		smdp: '',
		matchingId: '',
		imei: '',
		confirmationCode: ''
	});
	assert.strictEqual(downloadView.retryBlocked, false,
		'a rejected busy request followed by idle did not submit this form and may be retried');
	assert.strictEqual(downloadView.activeJob, null,
		'busy followed by idle must not invent a download job for the rejected request');
	assert.strictEqual(downloadView.activeJobOrigin, null,
		'busy followed by idle must leave no ownership state behind');
	assert.strictEqual(downloadById('lpac-download-button').disabled, false,
		'busy followed by idle should restore the form instead of claiming an unknown outcome');
	assert.strictEqual(activationInput.value, 'LPA:1$unsent.example.com$UNSENT',
		'busy followed by idle should retain the unsent activation code');
	assert.strictEqual(textContent(notifications.at(-1).content), 'busy',
		'busy followed by idle should report the definitive busy result');

	const lostStartStatusCalls = [];
	const notificationsBeforeLostStart = notifications.length;
	let resolveLostStartStatus = null;
	activationInput.value = speedtestCode;
	lpac.downloadProfile = function() {
		return Promise.resolve({ success: false, error: 'transport_error' });
	};
	lpac.getDownloadStatus = function(jobId) {
		lostStartStatusCalls.push(jobId);

		return new Promise(function(resolve) {
			resolveLostStartStatus = resolve;
		});
	};
	const lostStart = downloadView.startDownload({
		mode: 'activation',
		activationCode: speedtestCode,
		smdp: '',
		matchingId: '',
		imei: '',
		confirmationCode: ''
	});
	for (let i = 0; i < 8 && resolveLostStartStatus === null; i++)
		await Promise.resolve();

	assert.strictEqual(typeof resolveLostStartStatus, 'function',
		'an ambiguous start should begin exactly one current-job recovery request');
	assert.deepStrictEqual(lpac.getDownloadVerification(), {
		required: true,
		pending: true,
		profiles: false,
		notifications: false,
		storageAvailable: true
	}, 'an ambiguous start must persist its verification marker before recovery finishes');
	const storedAmbiguousMarker = browserStorage.getItem(verificationStorageKey);
	assert.ok(!storedAmbiguousMarker.includes(speedtestCode) &&
		!storedAmbiguousMarker.includes('LPA:'),
		'the persistent ambiguity marker must not contain an activation credential');
	const concurrentRecoveryPoll = downloadView.pollDownload();
	const duplicateRecoveryPoll = downloadView.pollDownload();
	assert.strictEqual(concurrentRecoveryPoll, duplicateRecoveryPoll,
		'concurrent polls should join the in-flight start-recovery status check');
	assert.deepStrictEqual(lostStartStatusCalls, [ 0 ],
		'start recovery and concurrent polling must issue only one status request');
	resolveLostStartStatus({
		success: true,
		data: { job_id: 29, status: 'running' }
	});
	await Promise.all([ lostStart, concurrentRecoveryPoll, duplicateRecoveryPoll ]);
	assert.deepStrictEqual(lostStartStatusCalls, [ 0 ],
		'an ambiguous lost start response should query the recoverable current job');
	assert.strictEqual(downloadView.activeJob, 29,
		'the view should attach to a job that started despite the lost RPC response');
	assert.strictEqual(downloadView.activeJobOrigin, 'uncertain',
		'a job discovered after a lost start response must not be claimed by this form');
	assert.strictEqual(notifications.length, notificationsBeforeLostStart,
		'a successfully recovered lost start response must not report a false error');
	assert.strictEqual(downloadById('lpac-download-progress').style.display, '',
		'the recovered running job should remain visibly in progress');
	assert.strictEqual(downloadById('lpac-download-button').disabled, true,
		'the recovered running job should prevent a duplicate profile download');
	assert.ok(textContent(downloadById('lpac-download-progress-text'))
		.includes('start response was lost'),
		'the progress state should disclose that the recovered job ownership is uncertain');

	lpac.getDownloadStatus = function(jobId) {
		return Promise.resolve({ success: true, data: { job_id: jobId, status: 'success' } });
	};
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, null,
		'the uncertain recovered job should still reach a terminal state');
	assert.strictEqual(activationInput.value, speedtestCode,
		'an uncertain terminal success must preserve the activation code for verification');
	assert.strictEqual(downloadView.retryBlocked, true,
		'an uncertain terminal success must require verification before another submission');
	assert.strictEqual(downloadById('lpac-download-verification').style.display, '',
		'the uncertain terminal success should leave persistent verification guidance');
	assert.strictEqual(notifications.at(-1).level, 'warning',
		'an uncertain job must not be announced as this form\'s successful download');

	completeDownloadVerification(downloadView);
	assert.strictEqual(downloadView.retryBlocked, false,
		'successfully visiting both verification views should unblock a later download');
	lpac.downloadProfile = function() {
		return Promise.resolve({
			success: true,
			data: {
				job_id: 29,
				status: 'running',
				phase: 'authenticating',
				decision_token: 'R'.repeat(32)
			}
		});
	};
	await downloadView.startDownload({
		mode: 'activation',
		activationCode: speedtestCode,
		smdp: '',
		matchingId: '',
		imei: '',
		confirmationCode: ''
	});
	assert.strictEqual(downloadView.activeJobOrigin, 'owned',
		'a direct start result should establish ownership before rediscovery is needed');
	assert.strictEqual(downloadView.activeDecisionToken, 'R'.repeat(32),
		'only the direct start response should establish preview decision ownership');
	downloadView.handlePreviewState({
		success: true,
		data: {
			job_id: 29,
			status: 'running',
			phase: 'awaiting_confirmation',
			preview: null
		}
	});
	assert.strictEqual(modal.title, 'Review eSIM profile',
		'the owned job should expose its null-metadata decision before it disappears');
	const staleInstallButton = byText(modal.content,
		'button', 'Install without metadata')[0];
	const decisionsBeforeMissingJob = previewDecisionCalls.length;

	const rediscoveryCalls = [];
	let rediscoveryCurrentChecks = 0;
	lpac.getDownloadStatus = function(jobId) {
		rediscoveryCalls.push(jobId);

		if (jobId === 29)
			return Promise.resolve({ success: false, error: 'job_not_found' });

		rediscoveryCurrentChecks++;
		return Promise.resolve(rediscoveryCurrentChecks === 1
			? {}
			: { success: true, data: { job_id: 31, status: 'running' } });
	};
	await downloadView.pollDownload();
	assert.deepStrictEqual(rediscoveryCalls, [ 29, 0 ],
		'a malformed current-job response should be retried after the remembered job disappears');
	assert.strictEqual(downloadView.activeJob, 29,
		'a malformed rediscovery response must not abandon the remembered owned job');
	assert.strictEqual(downloadView.activeJobOrigin, 'owned',
		'a malformed rediscovery response must not change job ownership');
	assert.strictEqual(modal, null,
		'a definitive missing-job response must close its stale preview decision');
	assert.strictEqual(downloadView.previewDecisionSent, true,
		'a missing owned job must permanently consume the stale frontend decision path');
	await staleInstallButton.attrs.click();
	assert.strictEqual(previewDecisionCalls.length, decisionsBeforeMissingJob,
		'a detached stale modal handler must not approve a missing job');
	await downloadView.pollDownload();
	assert.deepStrictEqual(rediscoveryCalls, [ 29, 0, 29, 0 ],
		'a missing remembered job should rediscover the backend current job');
	assert.strictEqual(downloadView.activeJob, 31,
		'current-job rediscovery should reattach even when the opaque ID changed');
	assert.strictEqual(downloadView.activeJobOrigin, 'external',
		'a different rediscovered job identifier must not retain ownership attribution');
	assert.strictEqual(downloadView.activeDecisionToken, null,
		'a public rediscovery response must discard the prior job decision token');
	assert.strictEqual(downloadView.retryBlocked, true,
		'losing an owned job must preserve verification blocking while an external job runs');

	lpac.getDownloadStatus = function(jobId) {
		return Promise.resolve({ success: true, data: { job_id: jobId, status: 'success' } });
	};
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, null,
		'the recovered job should still reach its normal terminal success path');
	assert.strictEqual(activationInput.value, speedtestCode,
		'a different rediscovered job must not clear the original form credentials');
	assert.strictEqual(downloadView.retryBlocked, true,
		'the missing owned job outcome must remain blocked after the external job ends');

	completeDownloadVerification(downloadView);
	assert.strictEqual(downloadView.retryBlocked, false,
		'a second ambiguous outcome should also require both successful views');

	let ambiguousStatusPolls = 0;
	lpac.downloadProfile = function() {
		return Promise.resolve({ success: false, error: 'transport_error' });
	};
	lpac.getDownloadStatus = function() {
		ambiguousStatusPolls++;

		return Promise.resolve(ambiguousStatusPolls < 3
			? { success: false, error: 'transport_error' }
			: { success: true, data: { status: 'idle' } });
	};
	await downloadView.startDownload({
		mode: 'activation',
		activationCode: speedtestCode,
		smdp: '',
		matchingId: '',
		imei: '',
		confirmationCode: ''
	});
	assert.strictEqual(downloadView.downloadStarting, true,
		'a doubly lost start/status response should keep duplicate starts disabled');
	assert.strictEqual(downloadById('lpac-download-button').disabled, true,
		'an ambiguous start must remain blocked while current-job checks are retried');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.downloadStarting, true,
		'a repeated status transport error should retain the uncertain start state');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.downloadStarting, false,
		'an eventual idle response should terminate the uncertain start probe');
	assert.strictEqual(downloadView.retryBlocked, true,
		'an unobservable fast completion must require profile verification before retry');
	assert.strictEqual(downloadById('lpac-download-button').disabled, true,
		'the same page must not resubmit an activation code with an unknown outcome');
	assert.strictEqual(downloadById('lpac-download-verification').style.display, '',
		'an unknown outcome should leave persistent verification guidance on the page');
	assert.ok(textContent(downloadById('lpac-download-verification'))
		.includes('Open Profiles and Notifications'),
		'the persistent guidance should explain how to verify before retrying');
	let blockedDirectStarts = 0;
	lpac.downloadProfile = function() {
		blockedDirectStarts++;
		return Promise.resolve({ success: true, data: { job_id: 99, status: 'running' } });
	};
	await downloadView.startDownload({
		mode: 'activation',
		activationCode: speedtestCode,
		smdp: '',
		matchingId: '',
		imei: '',
		confirmationCode: ''
	});
	assert.strictEqual(blockedDirectStarts, 0,
		'the start invariant should reject direct or stale handlers after an unknown outcome');
	const blockedModal = modal;
	const blockedModalNotifications = notifications.length;
	downloadView.showDownloadModal();
	assert.strictEqual(modal, blockedModal,
		'a direct modal handler must not bypass the unknown-outcome block');
	assert.strictEqual(notifications.length, blockedModalNotifications + 1,
		'a blocked modal attempt should repeat the verification guidance');
	downloadView.clearForm();
	assert.strictEqual(downloadView.retryBlocked, true,
		'clearing visible credentials must not clear the unknown-outcome invariant');
	assert.strictEqual(downloadById('lpac-download-button').disabled, true,
		'the Download action must remain blocked after Clear');

	lpac.getDownloadStatus = function() {
		return Promise.resolve({ success: true, data: { status: 'idle' } });
	};
	const blockedReloadView = loadView('download.js');
	const blockedReloadStatus = await blockedReloadView.load();
	const blockedReloadPage = blockedReloadView.render(blockedReloadStatus);
	documentRoot = blockedReloadPage;
	assert.strictEqual(blockedReloadView.retryBlocked, true,
		'an unknown-outcome block should survive view reload and re-entry');
	assert.strictEqual(document.getElementById('lpac-download-button').disabled, true,
		'the reloaded Download action must retain the persistent block');

	profilesView.render({ success: true, data: [] });
	window.dispatchStorage(verificationProfilesKey);
	assert.deepStrictEqual(lpac.getDownloadVerification(), {
		required: true,
		pending: false,
		profiles: true,
		notifications: false,
		storageAvailable: true
	}, 'a successful Profiles visit should be retained without clearing the block alone');
	assert.strictEqual(blockedReloadView.retryBlocked, true,
		'an existing Download tab should remain blocked after only Profiles succeeds');
	notificationsView.render({ success: false, error: 'transport_error' });
	window.dispatchStorage(verificationNotificationsKey);
	assert.strictEqual(blockedReloadView.retryBlocked, true,
		'a failed Notifications visit must not count as verification');
	notificationsView.render({ success: true, data: [] });
	window.dispatchStorage(verificationNotificationsKey);
	assert.strictEqual(lpac.getDownloadVerification().required, false,
		'a successful visit to both required views should clear the persistent marker');
	assert.strictEqual(blockedReloadView.retryBlocked, false,
		'an existing Download tab should observe verification completed in another tab');
	assert.strictEqual(document.getElementById('lpac-download-button').disabled, false,
		'the cross-tab storage event should restore Download only after both views succeed');

	lpac.requireDownloadVerification();
	window.dispatchStorage(verificationStorageKey);
	assert.strictEqual(blockedReloadView.retryBlocked, true,
		'an existing Download tab should immediately adopt a new ambiguity marker');
	assert.strictEqual(blockedReloadView.checkingCurrentJob, true,
		'a tab receiving a pending marker should begin current-job recovery');
	const pendingReloadView = loadView('download.js');
	const pendingReloadStatus = await pendingReloadView.load();
	const pendingReloadPage = pendingReloadView.render(pendingReloadStatus);
	documentRoot = pendingReloadPage;
	assert.strictEqual(pendingReloadView.retryBlocked, true,
		'a pending marker with canonical idle status should remain blocked');
	assert.deepStrictEqual(lpac.getDownloadVerification(), {
		required: true,
		pending: false,
		profiles: false,
		notifications: false,
		storageAvailable: true
	}, 'canonical idle on re-entry should settle a pending marker and enable verification');
	completeDownloadVerification(pendingReloadView);
	assert.strictEqual(pendingReloadView.retryBlocked, false,
		'both successful views should clear a marker settled during initial render');

	const availableVerificationReader = lpac.getDownloadVerification;

	lpac.getDownloadVerification =
		unavailableLpacClient.getDownloadVerification.bind(unavailableLpacClient);
	const unavailableStorageView = loadView('download.js');
	const unavailableStorageStatus = await unavailableStorageView.load();
	const unavailableStoragePage = unavailableStorageView.render(unavailableStorageStatus);
	documentRoot = unavailableStoragePage;
	assert.strictEqual(document.getElementById('lpac-download-button').disabled, true,
		'unavailable browser storage should visibly keep Download fail-closed');
	assert.ok(textContent(document.getElementById('lpac-download-verification'))
		.includes('Browser site storage is unavailable'),
		'the fail-closed page should explain how browser storage affects verification');
	lpac.getDownloadVerification = availableVerificationReader;

	const recoveredStatusCalls = [];
	lpac.getDownloadStatus = function(jobId) {
		recoveredStatusCalls.push(jobId);
		return Promise.resolve({ success: true, data: { job_id: 73, status: 'running' } });
	};
	const recoveredView = loadView('download.js');
	const recoveredStatus = await recoveredView.load();
	const recoveredPage = recoveredView.render(recoveredStatus);
	documentRoot = recoveredPage;
	assert.deepStrictEqual(recoveredStatusCalls, [ 0 ],
		'a newly rendered view should discover a download that survived navigation');
	assert.strictEqual(recoveredView.activeJob, 73,
		'the newly rendered view should reattach to the current running job');
	assert.strictEqual(recoveredView.activeJobOrigin, 'external',
		'a download discovered during navigation must not be attributed to this form');
	assert.strictEqual(document.getElementById('lpac-download-progress').style.display, '',
		'the navigation-recovered job should display persistent progress');
	assert.strictEqual(document.getElementById('lpac-download-button').disabled, true,
		'the navigation-recovered job should keep download controls disabled');

	let unverifiedView = null;
	let unverifiedPage = null;
	for (const initialUnverifiedStatus of [ null, {} ]) {
		lpac.getDownloadStatus = function() {
			return Promise.resolve(initialUnverifiedStatus);
		};
		unverifiedView = loadView('download.js');
		const loadedUnverifiedStatus = await unverifiedView.load();
		unverifiedPage = unverifiedView.render(loadedUnverifiedStatus);
		documentRoot = unverifiedPage;
		assert.strictEqual(unverifiedView.checkingCurrentJob, true,
			'an absent or malformed initial status must remain unverified');
		assert.strictEqual(document.getElementById('lpac-download-progress').style.display, '',
			'an unverified initial status should display an automatic-retry notice');
		[ 'lpac-download-mode', 'lpac-activation-code', 'lpac-qr-file-button',
			'lpac-download-clear', 'lpac-download-button' ].forEach(function(id) {
			assert.strictEqual(document.getElementById(id).disabled, true,
				`${id} should stay disabled until the current-job state is verified`);
		});
	}

	const initialRecoveryStatuses = [
		{},
		{ success: true, data: { status: 'idle' } }
	];
	lpac.getDownloadStatus = function() {
		return Promise.resolve(initialRecoveryStatuses.shift());
	};
	await unverifiedView.pollDownload();
	assert.strictEqual(unverifiedView.checkingCurrentJob, true,
		'a malformed retry must not silently enable an unverified form');
	assert.strictEqual(document.getElementById('lpac-download-button').disabled, true,
		'the malformed retry should keep Download disabled');
	await unverifiedView.pollDownload();
	assert.strictEqual(unverifiedView.checkingCurrentJob, false,
		'a canonical idle response should resolve the initial uncertainty');
	assert.strictEqual(document.getElementById('lpac-download-progress').style.display, 'none',
		'the initial-status notice should hide after a canonical idle response');
	assert.strictEqual(document.getElementById('lpac-download-button').disabled, false,
		'the form should become usable only after a canonical idle response');

	lpac.getDownloadStatus = function() {
		return Promise.resolve({ success: false, error: 'transport_error' });
	};
	const transientInitialView = loadView('download.js');
	const transientInitialStatus = await transientInitialView.load();
	const transientInitialPage = transientInitialView.render(transientInitialStatus);
	documentRoot = transientInitialPage;
	document.getElementById('lpac-activation-code').value =
		'LPA:1$waiting.example.com$WAITING';
	let transientInitialPolls = 0;
	lpac.getDownloadStatus = function() {
		transientInitialPolls++;
		return Promise.resolve(transientInitialPolls === 1
			? { success: false, error: 'transport_error' }
			: { success: true, data: { job_id: 88, status: 'running' } });
	};
	await transientInitialView.pollDownload();
	assert.strictEqual(transientInitialView.checkingCurrentJob, true,
		'a repeated initial transport failure should keep the form disabled and retrying');
	assert.strictEqual(document.getElementById('lpac-download-button').disabled, true,
		'Download must stay disabled through repeated initial transport failures');
	await transientInitialView.pollDownload();
	assert.strictEqual(transientInitialView.activeJobOrigin, 'external',
		'a job found while recovering initial status must be treated as external');
	assert.ok(textContent(document.getElementById('lpac-download-progress-text'))
		.includes('Another'),
		'the recovered initial job should be described as another download');
	lpac.getDownloadStatus = function(jobId) {
		return Promise.resolve({ success: true, data: { job_id: jobId, status: 'success' } });
	};
	await transientInitialView.pollDownload();
	assert.strictEqual(document.getElementById('lpac-activation-code').value,
		'LPA:1$waiting.example.com$WAITING',
		'an initial-status recovery must preserve form data when the external job ends');
	assert.strictEqual(transientInitialView.retryBlocked, false,
		'an external job discovered before submission must not block a later retry');

	L.hasViewPermission = function() { return false; };
	lpac.getDownloadStatus = function() {
		return Promise.resolve({ success: false, error: 'job_not_found' });
	};
	const readonlyView = loadView('download.js');
	const readonlyStatus = await readonlyView.load();
	const readonlyPage = readonlyView.render(readonlyStatus);
	documentRoot = readonlyPage;
	[ 'lpac-download-mode', 'lpac-activation-code', 'lpac-qr-file',
		'lpac-qr-camera', 'lpac-qr-file-button', 'lpac-qr-camera-button',
		'lpac-download-button' ].forEach(function(id) {
		const control = findAll(readonlyPage, function(node) {
			return node.attrs?.id === id;
		})[0];

		assert.ok(control.attrs.disabled != null,
			`${id} should be disabled without write permission`);
	});
	L.hasViewPermission = function() { return true; };
}

testOverviewDefaultSmdp().then(testNotificationProcessing).then(testDownloadView).then(function() {
	console.log('ok - frontend Overview readback, discovery, preview, icons, notifications, QR decoding, and safety states');
}).catch(function(error) {
	console.error(error);
	process.exitCode = 1;
});
