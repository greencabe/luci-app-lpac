// SPDX-License-Identifier: Apache-2.0
/* global require, __dirname, global, process */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
let modal = null;
let documentRoot = null;
const notifications = [];
const pollEntries = [];

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
		style: {},
		appendChild: function(child) {
			this.children.push(child);
		},
		getAttribute: function(name) {
			return this.attrs[name] ?? null;
		},
		removeAttribute: function(name) {
			delete this.attrs[name];
			delete this[name];
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
						getImageData: function() {
							return { data: new Uint8ClampedArray(4) };
						}
					};
				}
			};
		}

		return { tag, async: false };
	},
	head: {
		appendChild: function(script) {
			throw new Error(`unexpected external script load: ${script.src}`);
		}
	}
};
global.window = { location: { reload: function() {} } };

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

function byText(root, tag, label) {
	return findAll(root, function(node) {
		return node.tag === tag && textContent(node) === label;
	});
}

const profile = {
	iccid: '8912345678901234567',
	isdpAid: 'A0000005591010FFFFFFFF8900001000',
	profileState: 'disabled',
	profileNickname: 'Test profile',
	serviceProviderName: 'Test provider'
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
		seqNumber: 1,
		profileManagementOperation: 'enable',
		iccid: profile.iccid,
		notificationAddress: 'example.invalid'
	} ]
});
const removeButtons = byText(notificationsPage, 'button', 'Remove');
assert.strictEqual(removeButtons.length, 1, 'Remove button should exist');
assert.ok(removeButtons[0].attrs.disabled == null,
	'Remove button must omit the disabled attribute for a writable nonzero sequence');
assert.strictEqual(findAll(notificationsPage, function(node) {
	return node.attrs?.class === 'alert-message warning' &&
		textContent(node).startsWith('Sending notifications is disabled');
}).length, 1, 'the page-wide TLS limitation should remain a prominent warning');

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
	const decoderAsset = require(path.join(appRoot,
		'htdocs/luci-static/resources/jsqr.min.js'));
	assert.strictEqual(typeof decoderAsset, 'function',
		'the vendored jsQR asset should expose its decoder function');

	const initialPollCount = pollEntries.length;
	const downloadView = loadView('download.js');
	const downloadPage = downloadView.render();
	documentRoot = downloadPage;

	assert.strictEqual(pollEntries.length, initialPollCount + 1,
		'the Download view should register one status poll');
	assert.strictEqual(pollEntries.at(-1).interval, 2,
		'the download status should be polled every two seconds');

	function downloadById(id) {
		return findAll(downloadPage, function(node) {
			return node.attrs?.id === id;
		})[0];
	}

	[
		'lpac-download-mode', 'lpac-activation-code', 'lpac-qr-file',
		'lpac-smdp', 'lpac-matching-id', 'lpac-confirmation-code',
		'lpac-imei', 'lpac-download-button'
	].forEach(function(id) {
		assert.ok(downloadById(id), `${id} should be rendered`);
	});

	const qrInput = downloadById('lpac-qr-file');
	assert.strictEqual(qrInput.attrs.accept, 'image/png,image/jpeg,image/webp',
		'the QR picker should limit uploads to supported image types');
	assert.strictEqual(qrInput.attrs.capture, 'environment',
		'the QR picker should offer the rear camera on mobile browsers');
	assert.ok(qrInput.attrs.disabled == null,
		'the QR picker should remain usable with write permission');
	assert.strictEqual(findAll(downloadPage, function(node) {
		return node.attrs?.class === 'alert-message warning';
	}).length, 0, 'profile download should not be hidden behind a TLS warning');

	const mode = downloadById('lpac-download-mode');
	const activationFields = downloadById('lpac-download-activation-fields');
	const manualFields = downloadById('lpac-download-manual-fields');
	mode.value = 'manual';
	downloadView.updateMode();
	assert.strictEqual(activationFields.style.display, 'none',
		'manual mode should hide activation-code controls');
	assert.strictEqual(manualFields.style.display, '',
		'manual mode should reveal non-interactive lpac parameters');

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
		/The SM-DP\+ address or matching ID is invalid/,
		'a nonempty manual matching ID should retain strict validation');
	matchingInput.value = 'MATCHING-ID';
	smdpInput.value = '[2001:db8::1]:65535';
	assert.strictEqual(downloadView.collectRequest().smdp, '[2001:db8::1]:65535',
		'the frontend should accept the bracketed IPv6 form accepted by the RPC');
	[ 'smdp.example.com:0', 'smdp.example.com:65536',
		'smdp.example.com/path' ].forEach(function(value) {
		smdpInput.value = value;
		assert.throws(function() { downloadView.collectRequest(); },
			/The SM-DP\+ address or matching ID is invalid/,
			`${value} should be rejected before invoking the RPC`);
	});
	smdpInput.value = 'smdp.example.com:443';

	mode.value = 'activation';
	downloadView.updateMode();
	assert.strictEqual(activationFields.style.display, '',
		'activation mode should restore activation-code controls');
	assert.strictEqual(manualFields.style.display, 'none',
		'activation mode should hide manual controls');
	downloadById('lpac-activation-code').value = 'LPA:1$smdp.example.com$';
	assert.strictEqual(downloadView.collectRequest().activationCode,
		'LPA:1$smdp.example.com$',
		'an upstream activation code may omit its matching ID');

	let decoderCalls = 0;
	let qrPayload = 'lpa:1$qr.example.com$';
	const localDecoder = function(data, width, height, options) {
		decoderCalls++;
		assert.ok(data instanceof Uint8ClampedArray,
			'the local decoder should receive browser pixel data');
		assert.strictEqual(width, 320);
		assert.strictEqual(height, 240);
		assert.strictEqual(options.inversionAttempts, 'attemptBoth');
		return { data: qrPayload };
	};
	window.jsQR = localDecoder;
	window.FileReader = function() {};
	window.FileReader.prototype.readAsDataURL = function() {
		this.result = 'data:image/png;base64,AA==';
		this.onload();
	};
	window.Image = function() {
		this.naturalWidth = 320;
		this.naturalHeight = 240;
	};
	Object.defineProperty(window.Image.prototype, 'src', {
		get: function() { return this.imageSource; },
		set: function(value) {
			this.imageSource = value;
			this.onload();
		}
	});

	qrInput.files = [ { type: 'application/pdf', size: 1024 } ];
	await downloadView.handleQRFile(qrInput);
	assert.strictEqual(decoderCalls, 0,
		'an explicitly unsupported MIME type should not reach the image decoder');
	assert.strictEqual(textContent(downloadById('lpac-qr-status')),
		'Select a PNG, JPEG, or WebP image.');

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
	assert.strictEqual(modal.title, 'Download eSIM profile',
		'Download should require confirmation before invoking lpac');
	assert.ok(!textContent(modal.content).includes('QR-MATCHING-ID'),
		'the confirmation dialog should not echo the activation secret');
	assert.ok(!textContent(modal.content).includes('1234'),
		'the confirmation dialog should not echo the confirmation code');

	const confirmButton = byText(modal.content, 'button', 'Download')[0];
	assert.ok(confirmButton, 'the confirmation dialog should expose Download');
	const starting = confirmButton.attrs.click();
	assert.strictEqual(downloadView.downloadStarting, true,
		'the view should record the in-flight start request');
	const startingModal = modal;
	downloadView.showDownloadModal();
	assert.strictEqual(modal, startingModal,
		'a repeated click while starting must not replace the progress modal');
	resolveDownloadStart({ success: true, data: { job_id: 17 } });
	await starting;
	assert.deepStrictEqual(downloadArguments, [
		'activation', 'LPA:1$qr.example.com$QR-MATCHING-ID$$1', '', '',
		'490154203237518', '1234'
	], 'the browser should pass the complete activation code and optional flags');
	assert.strictEqual(downloadView.activeJob, 17,
		'the returned asynchronous job identifier should be retained');
	assert.strictEqual(modal.title, 'Downloading eSIM profile',
		'the UI should remain in a progress state while lpac runs');
	const activeModal = modal;
	downloadView.showDownloadModal();
	assert.strictEqual(modal, activeModal,
		'a repeated click for an active job must not replace the progress modal');

	const statuses = [
		{ success: false, error: 'transport_error' },
		{ success: true, data: { status: 'running' } },
		{ success: true, data: { status: 'success' } }
	];
	const polledJobs = [];
	let rejectFirstPoll = true;
	lpac.getDownloadStatus = function(jobId) {
		polledJobs.push(jobId);

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
		'a running download should remain active');
	await downloadView.pollDownload();
	assert.strictEqual(downloadView.activeJob, null,
		'a completed download should leave the active state');
	assert.deepStrictEqual(polledJobs, [ 17, 17, 17, 17 ],
		'status polling should use only the opaque job identifier');
	assert.strictEqual(downloadById('lpac-activation-code').value, '',
		'the activation secret should be cleared after success');
	assert.strictEqual(downloadById('lpac-confirmation-code').value, '',
		'the confirmation code should be cleared after success');
	assert.strictEqual(downloadById('lpac-imei').value, '',
		'the optional IMEI should be cleared after success');
	assert.strictEqual(downloadById('lpac-qr-preview').style.display, 'none',
		'the local QR preview should be cleared after success');
	assert.strictEqual(notifications.at(-1).level, 'info',
		'a successful profile download should produce an information notice');

	L.hasViewPermission = function() { return false; };
	const readonlyView = loadView('download.js');
	const readonlyPage = readonlyView.render();
	documentRoot = readonlyPage;
	[ 'lpac-download-mode', 'lpac-activation-code', 'lpac-qr-file',
		'lpac-download-button' ].forEach(function(id) {
		const control = findAll(readonlyPage, function(node) {
			return node.attrs?.id === id;
		})[0];

		assert.ok(control.attrs.disabled != null,
			`${id} should be disabled without write permission`);
	});
	L.hasViewPermission = function() { return true; };
}

testDownloadView().then(function() {
	console.log('ok - frontend controls, download flow, QR decoding, menu, and safety states');
}).catch(function(error) {
	console.error(error);
	process.exitCode = 1;
});
