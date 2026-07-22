// SPDX-License-Identifier: Apache-2.0
/* global lpac */

'use strict';
'require view';
'require ui';
'require poll';
'require lpac';

const isReadonlyView = !L.hasViewPermission() || null;
const maxQRFileSize = 8 * 1024 * 1024;
const maxQRImagePixels = 40000000;
const qrDecodeSizes = [ 1600, 1200, 900, 700 ];
const jobOriginOwned = 'owned';
const jobOriginExternal = 'external';
const jobOriginUncertain = 'uncertain';
const activationEdgeMarks = [
	'\u00ad', '\u034f', '\u061c', '\u180e', '\u200b', '\u200c', '\u200d',
	'\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
	'\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\u2066', '\u2067',
	'\u2068', '\u2069', '\ufeff'
];
let jsQRPromise = null;

function formRow(label, input, description) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', {
			'class': 'cbi-value-title',
			'for': input.getAttribute('id') || null
		}, [ label ]),
		E('div', { 'class': 'cbi-value-field' }, [
			input,
			description ? E('div', { 'class': 'cbi-value-description' }, [ description ]) : E([])
		])
	]);
}

function textInput(id, type, placeholder, maxlength, disabled, inputHandler) {
	const attributes = {
		'id': id,
		'class': 'cbi-input-text',
		'type': type || 'text',
		'placeholder': placeholder || '',
		'maxlength': maxlength,
		'autocomplete': 'off',
		'spellcheck': 'false',
		'disabled': disabled === undefined ? isReadonlyView : disabled
	};

	if (inputHandler)
		attributes.input = inputHandler;

	return E('input', attributes);
}

function normalizeActivationCode(value) {
	value = String(value || '').trim();

	while (value.length) {
		let changed = false;

		for (let i = 0; i < activationEdgeMarks.length; i++) {
			const mark = activationEdgeMarks[i];

			if (value.startsWith(mark)) {
				value = value.slice(mark.length).trim();
				changed = true;
				break;
			}

			if (value.endsWith(mark)) {
				value = value.slice(0, -mark.length).trim();
				changed = true;
				break;
			}
		}

		if (!changed)
			break;
	}

	value = /^lpa:/i.test(value) ? `LPA:${value.slice(4)}` : value;

	const hasScheme = value.startsWith('LPA:');
	const fields = (hasScheme ? value.slice(4) : value).split('$');

	/* Avoid lpac 2.3.0 treating an empty optional fifth field as required. */
	if (fields.length === 5 && fields[4] === '')
		fields.pop();

	return (hasScheme ? 'LPA:' : '') + fields.join('$');
}

function hasActivationFormatMark(value) {
	for (let i = 0; i < activationEdgeMarks.length; i++)
		if (value.includes(activationEdgeMarks[i]))
			return true;

	return false;
}

function validSmdp(value) {
	if (!value || value.length > 255 || value.includes('..'))
		return false;

	const parsed = value.match(
		/^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::([0-9]{1,5}))?$/);

	if (!parsed)
		return false;

	if (parsed[1]) {
		const port = Number(parsed[1]);

		if (port < 1 || port > 65535)
			return false;
	}

	return true;
}

function validMatchingId(value) {
	return value.length <= 255 && /^[A-Za-z0-9-]+$/.test(value);
}

function activationCodeIssue(value, confirmationCode, allowMissingConfirmation) {
	let code = normalizeActivationCode(value);

	if (code.length < 5 || code.length > 4096 || /\s/.test(code) ||
	    hasActivationFormatMark(code))
		return 'format';

	if (code.startsWith('LPA:'))
		code = code.slice(4);

	const fields = code.split('$');

	if (fields.length < 3 || fields.length > 5 || fields[0] !== '1' ||
	    !fields[1] || !validSmdp(fields[1]) ||
	    (fields[2] && !validMatchingId(fields[2])) ||
	    (fields.length >= 4 && fields[3].length > 255))
		return 'format';

	if (fields.length === 5 && fields[4] && fields[4] !== '0' && fields[4] !== '1')
		return 'format';

	if (!allowMissingConfirmation && fields.length === 5 && fields[4] === '1' &&
	    confirmationCode.length === 0)
		return 'confirmation_required';

	return null;
}

function validActivationCode(value, confirmationCode, allowMissingConfirmation) {
	return activationCodeIssue(value, confirmationCode, allowMissingConfirmation) === null;
}

function activationServer(value) {
	const code = normalizeActivationCode(value);
	const fields = (code.startsWith('LPA:') ? code.slice(4) : code).split('$');

	return fields[1] || '';
}

function validationError(message, fieldId) {
	const error = new Error(message);

	error.fieldId = fieldId;
	return error;
}

function isIdleDownloadStatus(result) {
	return result?.success === true && result.data?.status === 'idle';
}

function isTerminalDownloadStatus(result) {
	if (result?.success === true)
		return result.data?.status === 'success' || result.data?.status === 'cancelled';

	return result?.success === false && [
		'execution_failed', 'lpac_error', 'not_installed', 'timeout'
	].includes(result.error);
}

function loadJsQR() {
	if (typeof window.jsQR === 'function')
		return Promise.resolve(window.jsQR);

	if (jsQRPromise)
		return jsQRPromise;

	jsQRPromise = new Promise(function(resolve, reject) {
		const script = document.createElement('script');

		script.src = L.resource('jsqr.min.js');
		script.async = true;
		script.onload = function() {
			if (typeof window.jsQR === 'function')
				resolve(window.jsQR);
			else {
				jsQRPromise = null;
				reject(new Error(_('The QR decoder did not initialize.')));
			}
		};
		script.onerror = function() {
			jsQRPromise = null;
			reject(new Error(_('The QR decoder could not be loaded.')));
		};
		document.head.appendChild(script);
	});

	return jsQRPromise;
}

function readImage(file) {
	return new Promise(function(resolve, reject) {
		const reader = new window.FileReader();

		reader.onerror = function() {
			reject(new Error(_('The selected image could not be read.')));
		};
		reader.onload = function() {
			const image = new window.Image();

			image.onerror = function() {
				reject(new Error(_('The selected file is not a readable image.')));
			};
			image.onload = function() {
				resolve({ image, dataUrl: reader.result });
			};
			image.src = reader.result;
		};
		reader.readAsDataURL(file);
	});
}

function decodeImage(decoder, image) {
	const sourceWidth = image.naturalWidth || image.width;
	const sourceHeight = image.naturalHeight || image.height;
	const tried = {};

	if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > maxQRImagePixels)
		throw new Error(_('The QR image dimensions are invalid or too large.'));

	for (let i = 0; i < qrDecodeSizes.length; i++) {
		const scale = Math.min(1, qrDecodeSizes[i] / Math.max(sourceWidth, sourceHeight));
		const width = Math.max(1, Math.round(sourceWidth * scale));
		const height = Math.max(1, Math.round(sourceHeight * scale));
		const key = `${width}x${height}`;

		if (tried[key])
			continue;

		tried[key] = true;

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d', { willReadFrequently: true });

		if (!context)
			throw new Error(_('The browser cannot prepare the QR image.'));

		canvas.width = width;
		canvas.height = height;
		context.drawImage(image, 0, 0, width, height);

		const imageData = context.getImageData(0, 0, width, height);
		const decoded = decoder(imageData.data, width, height, {
			inversionAttempts: 'attemptBoth'
		});

		if (decoded && typeof decoded.data === 'string')
			return normalizeActivationCode(decoded.data);
	}

	return null;
}

return view.extend({
	activeJob: null,
	activeJobOrigin: null,
	activeDecisionToken: null,
	activePhase: null,
	activeSmdp: null,
	downloadStarting: false,
	checkingCurrentJob: false,
	previewDecisionSent: false,
	previewModalJob: null,
	qrActivationCode: null,
	qrDecodeGeneration: 0,
	qrDecoding: false,
	pollRegistered: false,
	statusFailures: 0,
	pendingStartResult: null,
	retryBlocked: false,

	load: function() {
		this.activeJob = null;
		this.activeJobOrigin = null;
		this.activeDecisionToken = null;
		this.activePhase = null;
		this.activeSmdp = null;
		this.downloadStarting = false;
		this.checkingCurrentJob = false;
		this.previewDecisionSent = false;
		this.previewModalJob = null;
		this.pendingStartResult = null;
		this.statusFailures = 0;
		this.retryBlocked = false;
		return L.resolveDefault(lpac.getDownloadStatus(0, ''), null);
	},

	isBusy: function() {
		return !!(this.activeJob || this.downloadStarting || this.checkingCurrentJob);
	},

	updateControls: function() {
		const busy = this.isBusy();
		const disabled = !!isReadonlyView || busy;

		[
			'lpac-download-mode', 'lpac-activation-code', 'lpac-qr-file',
			'lpac-qr-camera', 'lpac-qr-file-button', 'lpac-qr-camera-button',
			'lpac-smdp', 'lpac-matching-id', 'lpac-imei',
			'lpac-confirmation-code', 'lpac-download-clear'
		].forEach(function(id) {
			const control = document.getElementById(id);

			if (control)
				control.disabled = disabled;
		});

		const download = document.getElementById('lpac-download-button');

		if (download)
			download.disabled = disabled || this.qrDecoding || this.retryBlocked;

		[ 'lpac-qr-file', 'lpac-qr-camera',
			'lpac-qr-file-button', 'lpac-qr-camera-button' ].forEach(function(id) {
			const control = document.getElementById(id);

			if (control)
				control.disabled = disabled || this.qrDecoding;
		}.bind(this));
	},

	setDownloadProgress: function(visible, message) {
		const status = document.getElementById('lpac-download-progress');
		const text = document.getElementById('lpac-download-progress-text');

		if (status)
			status.style.display = visible ? '' : 'none';

		if (text)
			text.textContent = message || '';
	},

	setVerificationRequired: function(visible) {
		const warning = document.getElementById('lpac-download-verification');

		if (warning)
			warning.style.display = visible ? '' : 'none';
	},

	runningJobMessage: function() {
		if (this.activePhase === 'awaiting_confirmation') {
			return this.activeJobOrigin === jobOriginOwned &&
				this.activeDecisionToken && !this.previewDecisionSent
				? _('The profile is ready for review. Confirm or cancel it in the preview dialog.')
				: _('A profile download is waiting for its original tab to confirm it; otherwise it will cancel automatically.');
		}

		if (this.activePhase === 'installing')
			return _('lpac is installing the approved profile…');

		if (this.activePhase === 'cancelling')
			return _('lpac is cancelling the profile download session…');

		if (this.activeJobOrigin === jobOriginOwned)
			return _('lpac is authenticating and retrieving the profile preview…');

		if (this.activeJobOrigin === jobOriginUncertain)
			return _('The start response was lost. Checking whether lpac is still running…');

		return _('Another profile download is running. Monitoring it before this form can be submitted.');
	},

	attachRunningJob: function(result, origin) {
		const id = result?.data?.job_id;

		if (!result?.success || result.data?.status !== 'running' ||
		    !Number.isInteger(id) || id < 1)
			return false;

		this.activeJob = id;
		let normalizedOrigin = origin === jobOriginOwned || origin === jobOriginUncertain
			? origin
			: jobOriginExternal;
		const token = result.data?.decision_token;

		if (normalizedOrigin === jobOriginOwned) {
			if (typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token))
				this.activeDecisionToken = token;
			else {
				this.activeDecisionToken = null;
				normalizedOrigin = jobOriginUncertain;
				this.retryBlocked = true;
			}
		}
		else {
			this.activeDecisionToken = null;
			this.activeSmdp = null;

			if (this.previewModalJob !== null)
				ui.hideModal();

			this.previewModalJob = null;
			this.previewDecisionSent = false;
		}

		this.activeJobOrigin = normalizedOrigin;
		this.activePhase = typeof result.data?.phase === 'string'
			? result.data.phase
			: 'authenticating';
		this.downloadStarting = false;
		this.checkingCurrentJob = false;
		this.statusFailures = 0;
		this.pendingStartResult = null;
		this.handlePreviewState(result);
		this.setDownloadProgress(true, this.runningJobMessage());
		this.setVerificationRequired(this.retryBlocked);
		this.updateControls();
		return true;
	},

	previewField: function(label, value) {
		return E('div', { 'class': 'cbi-value' }, [
			E('span', { 'class': 'cbi-value-title' }, [ label ]),
			E('span', { 'class': 'cbi-value-field' }, [ value || '-' ])
		]);
	},

	showProfilePreview: function(preview, smdp) {
		if (!this.activeJob || !this.activeDecisionToken ||
		    this.previewDecisionSent || this.previewModalJob === this.activeJob)
			return;

		this.previewModalJob = this.activeJob;
		const content = [];

		if (preview) {
			content.push(
				this.previewField(_('Profile name'), preview.profileName),
				this.previewField(_('Provider'), preview.serviceProviderName),
				this.previewField(_('ICCID'), preview.iccid),
				this.previewField(_('Profile class'), preview.profileClass)
			);
		}
		else {
			content.push(E('div', { 'class': 'alert-message warning', 'role': 'note' }, [
				_('The provider did not supply profile metadata. The profile identity cannot be verified before installation.')
			]));
		}

		content.push(
			this.previewField(_('SM-DP+ server'), smdp),
			E('p', { 'class': 'cbi-value-description', 'role': 'note' }, [
				_('Install continues this same authenticated lpac session. Cancel rejects it before PrepareDownload; opening a second session is not used for preview.')
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn cbi-button-negative',
					'click': ui.createHandlerFn(this, 'respondToPreview', false)
				}, [ _('Cancel download') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-positive important',
					'click': ui.createHandlerFn(this, 'respondToPreview', true)
				}, [ preview ? _('Install profile') : _('Install without metadata') ])
			])
		);

		ui.showModal(_('Review eSIM profile'), content);
	},

	handlePreviewState: function(result) {
		if (!result?.success || result.data?.status !== 'running' ||
		    result.data?.job_id !== this.activeJob)
			return;

		if (typeof result.data.phase === 'string')
			this.activePhase = result.data.phase;

		if (this.activePhase === 'awaiting_confirmation' &&
		    this.activeJobOrigin === jobOriginOwned && this.activeDecisionToken &&
		    !this.previewDecisionSent)
			this.showProfilePreview(result.data.preview ?? null,
				this.activeSmdp || _('Use the default address stored on the eUICC'));
	},

	respondToPreview: function(accept) {
		if (!this.activeJob || !this.activeDecisionToken ||
		    this.activePhase !== 'awaiting_confirmation' ||
		    this.previewDecisionSent)
			return;

		const jobId = this.activeJob;
		const token = this.activeDecisionToken;

		this.previewDecisionSent = true;
		this.previewModalJob = null;
		this.activePhase = accept ? 'installing' : 'cancelling';
		ui.hideModal();
		this.setDownloadProgress(true, accept
			? _('Authorizing profile installation…')
			: _('Cancelling the profile download session…'));
		this.updateControls();

		return lpac.respondDownloadPreview(jobId, token, !!accept).then(function(result) {
			if (!result || !result.success) {
				ui.addNotification(null, E('p', {}, [
					_('The preview response could not be confirmed. It will not be sent again automatically. Status polling will determine whether lpac continued or cancelled.'),
					' ', lpac.errorMessage(result)
				]), 'warning');
			}

			return this.pollDownload();
		}.bind(this));
	},

	openQRPicker: function(input) {
		if (input && !this.isBusy() && !this.qrDecoding && !isReadonlyView)
			input.click();
	},

	handleActivationInput: function() {
		const decoding = this.qrDecoding;
		const hadQRResult = this.qrActivationCode !== null;

		if (!decoding && !hadQRResult)
			return;

		if (decoding) {
			this.qrDecodeGeneration++;
			this.qrDecoding = false;
		}

		this.clearQRResult();
		this.setQRStatus('');
		this.updateControls();
	},

	updateMode: function() {
		const mode = document.getElementById('lpac-download-mode').value;
		const activation = document.getElementById('lpac-download-activation-fields');
		const manual = document.getElementById('lpac-download-manual-fields');

		activation.style.display = mode === 'activation' ? '' : 'none';
		manual.style.display = mode === 'manual' ? '' : 'none';
	},

	handleModeChange: function() {
		if (this.qrDecoding)
			this.handleActivationInput();

		this.updateMode();
	},

	setQRStatus: function(message, state) {
		const status = document.getElementById('lpac-qr-status');

		if (!status)
			return;

		status.className = state === 'error'
			? 'alert-message error'
			: 'cbi-value-description';
		status.setAttribute('role', state === 'error' ? 'alert' : 'status');
		status.textContent = message || '';
	},

	clearQRResult: function() {
		const activation = document.getElementById('lpac-activation-code');
		const preview = document.getElementById('lpac-qr-preview');

		[ 'lpac-qr-file', 'lpac-qr-camera' ].forEach(function(id) {
			const input = document.getElementById(id);

			if (input)
				input.value = '';
		});

		if (activation && this.qrActivationCode &&
		    activation.value === this.qrActivationCode)
			activation.value = '';

		this.qrActivationCode = null;

		if (preview) {
			preview.removeAttribute('src');
			preview.style.display = 'none';
		}
	},

	handleQRFile: function(input) {
		const file = input.files && input.files[0];

		if (!file)
			return;

		const generation = ++this.qrDecodeGeneration;
		this.clearQRResult();
		this.qrDecoding = true;

		this.updateControls();

		if (file.type && ![ 'image/png', 'image/jpeg', 'image/webp' ].includes(file.type)) {
			input.value = '';
			this.qrDecoding = false;
			this.setQRStatus(_('Select a PNG, JPEG, or WebP image.'), 'error');
			this.updateControls();
			return;
		}

		if (file.size > maxQRFileSize) {
			input.value = '';
			this.qrDecoding = false;
			this.setQRStatus(_('The QR image must not exceed 8 MiB.'), 'error');
			this.updateControls();
			return;
		}

		this.setQRStatus(_('Decoding QR code…'));

		return Promise.all([ loadJsQR(), readImage(file) ]).then(function(values) {
			if (generation !== this.qrDecodeGeneration)
				return;

			const activationCode = decodeImage(values[0], values[1].image);

			if (!activationCode || !validActivationCode(activationCode, '', true))
				throw new Error(_('No valid eSIM activation code was found in the image.'));

			document.getElementById('lpac-activation-code').value = activationCode;
			this.qrActivationCode = activationCode;
			const preview = document.getElementById('lpac-qr-preview');

			preview.src = values[1].dataUrl;
			preview.style.display = 'block';
			this.setQRStatus(
				activationCodeIssue(activationCode, '', false) === 'confirmation_required'
					? _('QR code decoded. Enter the confirmation code required by this profile.')
					: _('QR code decoded. The activation-code field has been filled.'));
		}.bind(this)).catch(function(error) {
			if (generation === this.qrDecodeGeneration) {
				input.value = '';
				this.setQRStatus(error.message, 'error');
			}
		}.bind(this)).finally(function() {
			if (generation === this.qrDecodeGeneration) {
				this.qrDecoding = false;
				this.updateControls();
			}
		}.bind(this));
	},

	clearForm: function() {
		if (this.isBusy())
			return;

		this.qrDecodeGeneration++;
		this.qrDecoding = false;

		[
			'lpac-activation-code', 'lpac-smdp', 'lpac-matching-id',
			'lpac-imei', 'lpac-confirmation-code', 'lpac-qr-file',
			'lpac-qr-camera'
		].forEach(function(id) {
			const input = document.getElementById(id);

			if (input)
				input.value = '';
		});

		this.clearQRResult();
		this.setQRStatus('');
		this.updateControls();
	},

	collectRequest: function() {
		const mode = document.getElementById('lpac-download-mode').value;
		const activationInput = document.getElementById('lpac-activation-code');
		const activationCode = normalizeActivationCode(activationInput.value);
		const smdp = document.getElementById('lpac-smdp').value.trim();
		const matchingId = document.getElementById('lpac-matching-id').value.trim();
		const imei = document.getElementById('lpac-imei').value.trim();
		const confirmationCode = document.getElementById('lpac-confirmation-code').value.trim();

		[
			'lpac-activation-code', 'lpac-smdp', 'lpac-matching-id',
			'lpac-confirmation-code', 'lpac-imei'
		].forEach(function(id) {
			document.getElementById(id).removeAttribute('aria-invalid');
		});

		if (mode === 'activation') {
			const issue = activationCodeIssue(activationCode, confirmationCode, false);

			if (issue === 'confirmation_required')
				throw validationError(
					_('This activation code requires a confirmation code.'),
					'lpac-confirmation-code');

			if (issue)
				throw validationError(_('Enter a valid LPA:1$… activation code.'),
					'lpac-activation-code');

			activationInput.value = activationCode;
		}
		else if (mode === 'manual') {
			if (smdp && !validSmdp(smdp))
				throw validationError(_('The SM-DP+ address is invalid.'), 'lpac-smdp');

			if (matchingId && !validMatchingId(matchingId))
				throw validationError(_('The matching ID is invalid.'), 'lpac-matching-id');
		}
		else {
			throw new Error(_('Select a valid download method.'));
		}

		if (confirmationCode.length > 255 || /[\u0000-\u001F\u007F]/.test(confirmationCode))
			throw validationError(
				_('Confirmation code is too long or contains control characters.'),
				'lpac-confirmation-code');

		if (imei && !/^[0-9]{14,16}$/.test(imei))
			throw validationError(_('IMEI must contain 14 to 16 digits.'), 'lpac-imei');

		return {
			mode,
			activationCode: mode === 'activation' ? activationCode : '',
			smdp: mode === 'manual' ? smdp : '',
			matchingId: mode === 'manual' ? matchingId : '',
			imei,
			confirmationCode
		};
	},

	showDownloadModal: function() {
		if (this.isBusy())
			return;

		if (this.retryBlocked) {
			ui.addNotification(null, E('p', {}, [ lpac.errorMessage({
				error: 'execution_failed',
				reason: 'outcome_unknown'
			}) ]), 'error');
			return;
		}

		if (this.qrDecoding) {
			ui.addNotification(null, E('p', {}, [
				_('Wait for the selected QR image to finish decoding.')
			]), 'warning');
			return;
		}

		let request;

		try {
			request = this.collectRequest();
		}
		catch (error) {
			const input = error.fieldId && document.getElementById(error.fieldId);

			if (input) {
				input.setAttribute('aria-invalid', 'true');
				input.focus();
			}

			ui.addNotification(null, E('p', {}, [ error.message ]), 'error');
			return;
		}

		const server = request.mode === 'activation'
			? activationServer(request.activationCode)
			: request.smdp;

		ui.showModal(_('Review eSIM profile'), [
			E('p', {}, [
				request.mode === 'activation'
					? _('Connect to the activation-code server and retrieve a profile preview?')
					: _('Connect with the supplied manual parameters and retrieve a profile preview?')
			]),
			E('p', {}, [
				E('strong', {}, [ _('SM-DP+ server:'), ' ' ]),
				server || _('Use the default address stored on the eUICC')
			]),
			E('p', { 'class': 'cbi-value-description', 'role': 'note' }, [
				_('lpac will pause before PrepareDownload. Installation begins only after you approve the provider metadata in the next dialog.')
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': ui.hideModal
				}, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-positive important',
					'click': ui.createHandlerFn(this, 'startDownload', request)
				}, [ _('Retrieve preview') ])
			])
		]);
	},

	startDownload: function(request) {
		if (this.activeJob || this.downloadStarting || this.checkingCurrentJob ||
		    this.qrDecoding || this.retryBlocked)
			return;

		this.downloadStarting = true;
		this.pendingStartResult = null;
		this.activeDecisionToken = null;
		this.activePhase = null;
		this.activeSmdp = request.mode === 'activation'
			? activationServer(request.activationCode)
			: request.smdp;
		this.previewDecisionSent = false;
		this.previewModalJob = null;
		ui.hideModal();
		this.setDownloadProgress(true, _('Starting the protected lpac preview session…'));
		this.updateControls();

		return lpac.downloadProfile(
			request.mode,
			request.activationCode,
			request.smdp,
			request.matchingId,
			request.imei,
			request.confirmationCode
		).then(function(result) {
			if (this.attachRunningJob(result, jobOriginOwned))
				return;

			if (result?.error === 'busy') {
				return lpac.getDownloadStatus(0, '').then(function(current) {
					if (!this.attachRunningJob(current, jobOriginExternal))
						throw new Error(lpac.errorMessage(result));
				}.bind(this), function() {
					throw new Error(lpac.errorMessage(result));
				});
			}

			const recoverable = !result || result.error === 'transport_error' ||
				result.success === true;

			if (!recoverable)
				throw new Error(lpac.errorMessage(result));

			this.pendingStartResult = result || {
				success: false,
				error: 'transport_error'
			};

			return lpac.getDownloadStatus(0, '').then(function(current) {
				if (this.attachRunningJob(current, jobOriginUncertain))
					return;

				if (isIdleDownloadStatus(current)) {
					this.finishDownload({
						success: false,
						error: 'execution_failed',
						reason: 'outcome_unknown'
					});
					return;
				}

				this.recordStatusFailure();
				this.setDownloadProgress(true,
					_('The start response was lost. Checking whether lpac is still running…'));
			}.bind(this));
		}.bind(this)).catch(function(error) {
			this.downloadStarting = false;
			this.activeJob = null;
			this.activeJobOrigin = null;
			this.activeDecisionToken = null;
			this.activePhase = null;
			this.activeSmdp = null;
			this.checkingCurrentJob = false;
			this.pendingStartResult = null;
			this.setDownloadProgress(false);
			this.updateControls();
			ui.addNotification(null, E('p', {}, [ error.message ]), 'error');
		}.bind(this));
	},

	recordStatusFailure: function() {
		this.statusFailures++;

		if (this.statusFailures >= 3)
			this.setDownloadProgress(true,
				_('Connection to the lpac service was lost. The download may still be running; status checks will continue automatically.'));
	},

	finishDownload: function(result) {
		const terminalStatus = result?.success ? result.data?.status : null;
		const origin = this.activeJobOrigin || (this.pendingStartResult !== null
			? jobOriginUncertain
			: jobOriginExternal);
		const ownedOutcomeUnknown = origin === jobOriginOwned &&
			(result?.reason === 'outcome_unknown' || result?.error === 'job_not_found');
		const verificationRequired = this.retryBlocked ||
			origin === jobOriginUncertain || ownedOutcomeUnknown;

		this.activeJob = null;
		this.activeJobOrigin = null;
		this.activeDecisionToken = null;
		this.activePhase = null;
		this.activeSmdp = null;
		this.downloadStarting = false;
		this.checkingCurrentJob = false;
		this.previewDecisionSent = false;

		if (this.previewModalJob !== null)
			ui.hideModal();

		this.previewModalJob = null;
		this.statusFailures = 0;
		this.pendingStartResult = null;
		this.retryBlocked = verificationRequired;
		this.setDownloadProgress(false);
		this.setVerificationRequired(this.retryBlocked);

		if (origin === jobOriginExternal) {
			this.updateControls();
			ui.addNotification(null, E('p', {}, [ this.retryBlocked
				? lpac.errorMessage({
					success: false,
					error: 'execution_failed',
					reason: 'outcome_unknown'
				})
				: _('The existing profile download ended. This form was not submitted; review Profiles and Notifications before continuing.')
			]), this.retryBlocked || !result?.success ? 'warning' : 'info');
		}
		else if (origin === jobOriginUncertain) {
			this.updateControls();
			ui.addNotification(null, E('p', {}, [ lpac.errorMessage({
				success: false,
				error: 'execution_failed',
				reason: 'outcome_unknown'
			}) ]), 'warning');
		}
		else if (terminalStatus === 'success') {
			this.clearForm();
			ui.addNotification(null, E('p', {}, [
				_('The eSIM profile was downloaded successfully. Open Profiles to verify and manage it.')
			]), 'info');
		}
		else if (terminalStatus === 'cancelled') {
			this.updateControls();
			ui.addNotification(null, E('p', {}, [
				_('The profile download was cancelled before installation.')
			]), 'info');
		}
		else {
			this.updateControls();
			ui.addNotification(null, E('p', {}, [
				result?.success
					? lpac.errorMessage({ error: 'invalid_response' })
					: lpac.errorMessage(result)
			]), 'error');
		}
	},

	pollDownload: function() {
		if (this.checkingCurrentJob) {
			return lpac.getDownloadStatus(0, '').then(function(current) {
				if (this.attachRunningJob(current, jobOriginExternal))
					return;

				if (!isIdleDownloadStatus(current)) {
					this.recordStatusFailure();
					return;
				}

				this.checkingCurrentJob = false;
				this.statusFailures = 0;
				this.setDownloadProgress(false);
				this.updateControls();
			}.bind(this)).catch(function() {
				this.recordStatusFailure();
			}.bind(this));
		}

		if (!this.activeJob && (!this.downloadStarting || !this.pendingStartResult))
			return Promise.resolve();

		if (!this.activeJob) {
			return lpac.getDownloadStatus(0, '').then(function(current) {
				if (this.attachRunningJob(current, jobOriginUncertain))
					return;

				if (!isIdleDownloadStatus(current)) {
					this.recordStatusFailure();
					return;
				}

				this.finishDownload({
					success: false,
					error: 'execution_failed',
					reason: 'outcome_unknown'
				});
			}.bind(this)).catch(function() {
				this.recordStatusFailure();
			}.bind(this));
		}

		const jobId = this.activeJob;

		return lpac.getDownloadStatus(jobId,
			this.activeDecisionToken || '').then(function(result) {
			if (result && result.success && result.data?.status === 'running' &&
			    result.data?.job_id === jobId) {
				this.statusFailures = 0;
				this.handlePreviewState(result);
				this.setDownloadProgress(true, this.runningJobMessage());
				return;
			}

			if (result?.error === 'transport_error') {
				this.recordStatusFailure();
				return;
			}

			if (result?.error === 'job_not_found') {
				const missingOrigin = this.activeJobOrigin;

				if (this.previewModalJob !== null)
					ui.hideModal();

				this.previewModalJob = null;
				this.previewDecisionSent = true;

				return lpac.getDownloadStatus(0, '').then(function(current) {
					if (this.attachRunningJob(current, jobOriginExternal)) {
						if (missingOrigin !== jobOriginExternal) {
							this.retryBlocked = true;
							this.setVerificationRequired(true);
							this.updateControls();
						}

						return;
					}

					if (!isIdleDownloadStatus(current)) {
						this.recordStatusFailure();
						return;
					}

					this.finishDownload(result);
				}.bind(this));
			}

			if (!isTerminalDownloadStatus(result)) {
				this.recordStatusFailure();
				return;
			}

			this.finishDownload(result);
		}.bind(this)).catch(function() {
			/* Keep polling: the supervised lpac process may still be running. */
			this.recordStatusFailure();
		}.bind(this));
	},

	render: function(initialStatus) {
		if (!this.attachRunningJob(initialStatus, jobOriginExternal) &&
		    !isIdleDownloadStatus(initialStatus)) {
			this.checkingCurrentJob = true;
			this.statusFailures = 1;
		}

		if (!this.pollRegistered) {
			poll.add(this.pollDownload.bind(this), 2);
			this.pollRegistered = true;
		}

		const controlsDisabled = isReadonlyView || this.isBusy() || null;
		const mode = E('select', {
			'id': 'lpac-download-mode',
			'class': 'cbi-input-select',
			'disabled': controlsDisabled,
			'change': this.handleModeChange.bind(this)
		}, [
			E('option', { 'value': 'activation', 'selected': '' }, [
				_('Activation code or QR')
			]),
			E('option', { 'value': 'manual' }, [ _('Manual parameters') ])
		]);
		const makeQRInput = function(id, capture) {
			return E('input', {
				'id': id,
				'type': 'file',
				'accept': 'image/png,image/jpeg,image/webp',
				'capture': capture || null,
				'disabled': controlsDisabled,
				'style': 'display:none',
				'change': function(event) {
					return this.handleQRFile(event.currentTarget);
				}.bind(this)
			});
		}.bind(this);
		const qrFile = makeQRInput('lpac-qr-file');
		const qrCamera = makeQRInput('lpac-qr-camera', 'environment');
		const activationInput = textInput('lpac-activation-code', 'password',
			'LPA:1$smdp.example.com$MATCHING-ID', 4096, controlsDisabled,
			this.handleActivationInput.bind(this));

		activationInput.setAttribute('aria-describedby', 'lpac-qr-status');

		const pickerButton = function(id, label, input) {
			return E('button', {
				'id': id,
				'class': 'btn cbi-button cbi-button-neutral',
				'type': 'button',
				'disabled': controlsDisabled,
				'click': function(event) {
					if (event)
						event.preventDefault();

					this.openQRPicker(input);
				}.bind(this)
			}, [ label ]);
		}.bind(this);
		const hasActiveDownload = !!this.activeJob;
		const hasProgress = hasActiveDownload || this.checkingCurrentJob;

		return E([
			E('h2', {}, [ _('Download eSIM profile') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Use a complete LPA activation code, a locally decoded QR image, or manual lpac parameters. Every path pauses for provider-metadata review before installation.')
			]),
			E('div', { 'class': 'alert-message warning', 'role': 'note' }, [
				_('Security warning: lpac does not currently verify the profile-download server\'s TLS certificate or hostname. Only continue with a trusted activation source and network.')
			]),
			E('div', {
				'id': 'lpac-download-progress',
				'class': 'alert-message notice',
				'role': 'status',
				'aria-live': 'polite',
				'style': hasProgress ? '' : 'display:none'
			}, [
				E('span', { 'class': 'spinning' }),
				' ',
				E('span', { 'id': 'lpac-download-progress-text' }, [
					this.checkingCurrentJob
						? _('Unable to confirm whether a profile download is already running. Retrying automatically…')
						: (hasActiveDownload
							? _('Another profile download is running. Monitoring it before this form can be submitted.')
							: '')
				])
			]),
			E('div', {
				'id': 'lpac-download-verification',
				'class': 'alert-message warning',
				'role': 'alert',
				'style': this.retryBlocked ? '' : 'display:none'
			}, [
				_('The previous download outcome is unknown. Open Profiles and Notifications before returning here to retry.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Download method') ]),
				formRow(_('Method'), mode)
			]),
			E('div', { 'id': 'lpac-download-activation-fields' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, [ _('Activation code') ]),
					formRow(_('LPA string'), activationInput,
						_('Paste the complete LPA string supplied by the provider.')),
					formRow(_('QR image'), E('div', {}, [
						qrFile,
						qrCamera,
						pickerButton('lpac-qr-file-button', _('Choose QR image'), qrFile),
						' ',
						pickerButton('lpac-qr-camera-button', _('Take QR photo'), qrCamera)
					]),
					_('Choose an existing QR image or take a new photo. Decoding happens locally in this browser.')),
					E('div', { 'class': 'cbi-value' }, [
						E('div', { 'class': 'cbi-value-title' }),
						E('div', { 'class': 'cbi-value-field' }, [
							E('img', {
								'id': 'lpac-qr-preview',
								'alt': _('Selected QR image preview'),
								'style': 'display:none;max-width:100%;max-height:12rem'
							}),
							E('div', {
								'id': 'lpac-qr-status',
								'class': 'cbi-value-description',
								'role': 'status',
								'aria-live': 'polite'
							})
						])
					])
				])
			]),
			E('div', { 'id': 'lpac-download-manual-fields', 'style': 'display:none' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, [ _('Manual parameters') ]),
					formRow(_('SM-DP+ address'),
						textInput('lpac-smdp', 'text', 'smdp.example.com', 255,
							controlsDisabled),
						_('Optional. When empty, lpac uses the default SM-DP+ address configured on the eUICC.')),
					formRow(_('Matching ID'),
						textInput('lpac-matching-id', 'password', '', 255,
							controlsDisabled),
						_('Optional activation token passed to lpac with -m.'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Additional parameters') ]),
				formRow(_('Confirmation code'),
					textInput('lpac-confirmation-code', 'password', _('Optional'), 255,
						controlsDisabled),
					_('Provide this when the activation code or download order requires confirmation.')),
				formRow(_('IMEI'),
					textInput('lpac-imei', 'text', _('Optional'), 16,
						controlsDisabled),
					_('Optional 14- to 16-digit device identifier passed to lpac with -i.'))
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'id': 'lpac-download-clear',
					'class': 'btn cbi-button cbi-button-reset',
					'disabled': controlsDisabled,
					'click': ui.createHandlerFn(this, 'clearForm')
				}, [ _('Clear') ]),
				' ',
				E('button', {
					'id': 'lpac-download-button',
					'class': 'btn cbi-button cbi-button-positive important',
					'disabled': controlsDisabled || this.qrDecoding ||
						this.retryBlocked || null,
					'click': ui.createHandlerFn(this, 'showDownloadModal')
				}, [ _('Retrieve profile preview') ])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
