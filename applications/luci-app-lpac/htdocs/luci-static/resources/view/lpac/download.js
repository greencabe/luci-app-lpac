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

function textInput(id, type, placeholder, maxlength) {
	return E('input', {
		'id': id,
		'class': 'cbi-input-text',
		'type': type || 'text',
		'placeholder': placeholder || '',
		'maxlength': maxlength,
		'autocomplete': 'off',
		'spellcheck': 'false',
		'disabled': isReadonlyView
	});
}

function normalizeActivationCode(value) {
	value = String(value || '').trim();

	return /^lpa:/i.test(value) ? `LPA:${value.slice(4)}` : value;
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

function validActivationCode(value, confirmationCode, allowMissingConfirmation) {
	let code = normalizeActivationCode(value);

	if (code.length < 5 || code.length > 4096 || /\s/.test(code))
		return false;

	if (code.startsWith('LPA:'))
		code = code.slice(4);

	const fields = code.split('$');

	if (fields.length < 3 || fields.length > 5 || fields[0] !== '1' ||
	    !fields[1] || !validSmdp(fields[1]) ||
	    (fields[2] && !validMatchingId(fields[2])) ||
	    (fields.length >= 4 && fields[3].length > 255))
		return false;

	if (fields.length === 5 && fields[4] && fields[4] !== '0' && fields[4] !== '1')
		return false;

	return allowMissingConfirmation || fields.length < 5 || fields[4] !== '1' ||
		confirmationCode.length > 0;
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
	downloadStarting: false,
	qrActivationCode: null,
	qrDecodeGeneration: 0,

	updateMode: function() {
		const mode = document.getElementById('lpac-download-mode').value;
		const activation = document.getElementById('lpac-download-activation-fields');
		const manual = document.getElementById('lpac-download-manual-fields');

		activation.style.display = mode === 'activation' ? '' : 'none';
		manual.style.display = mode === 'manual' ? '' : 'none';
	},

	setQRStatus: function(message, state) {
		const status = document.getElementById('lpac-qr-status');

		status.className = state === 'error'
			? 'cbi-value-description error'
			: 'cbi-value-description';
		status.textContent = message || '';
	},

	clearQRResult: function() {
		const activation = document.getElementById('lpac-activation-code');
		const preview = document.getElementById('lpac-qr-preview');

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

		if (file.type && ![ 'image/png', 'image/jpeg', 'image/webp' ].includes(file.type)) {
			input.value = '';
			this.setQRStatus(_('Select a PNG, JPEG, or WebP image.'), 'error');
			return;
		}

		if (file.size > maxQRFileSize) {
			input.value = '';
			this.setQRStatus(_('The QR image must not exceed 8 MiB.'), 'error');
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
			this.setQRStatus(_('QR code decoded. The activation-code field has been filled.'));
		}.bind(this)).catch(function(error) {
			if (generation === this.qrDecodeGeneration)
				this.setQRStatus(error.message, 'error');
		}.bind(this));
	},

	clearForm: function() {
		if (this.activeJob || this.downloadStarting)
			return;

		this.qrDecodeGeneration++;

		[
			'lpac-activation-code', 'lpac-smdp', 'lpac-matching-id',
			'lpac-imei', 'lpac-confirmation-code', 'lpac-qr-file'
		].forEach(function(id) {
			const input = document.getElementById(id);

			if (input)
				input.value = '';
		});

		this.clearQRResult();
		this.setQRStatus('');
	},

	collectRequest: function() {
		const mode = document.getElementById('lpac-download-mode').value;
		const activationCode = normalizeActivationCode(
			document.getElementById('lpac-activation-code').value);
		const smdp = document.getElementById('lpac-smdp').value.trim();
		const matchingId = document.getElementById('lpac-matching-id').value.trim();
		const imei = document.getElementById('lpac-imei').value.trim();
		const confirmationCode = document.getElementById('lpac-confirmation-code').value.trim();

		if (mode === 'activation') {
			if (!validActivationCode(activationCode, confirmationCode))
				throw new Error(_('Enter a valid LPA:1$… activation code.'));
		}
		else if (mode === 'manual') {
			if ((smdp && !validSmdp(smdp)) ||
			    (matchingId && !validMatchingId(matchingId)))
				throw new Error(_('The SM-DP+ address or matching ID is invalid.'));
		}
		else {
			throw new Error(_('Select a valid download method.'));
		}

		if (confirmationCode.length > 255 || /[\u0000-\u001F\u007F]/.test(confirmationCode))
			throw new Error(_('Confirmation code is too long or contains control characters.'));

		if (imei && !/^[0-9]{14,16}$/.test(imei))
			throw new Error(_('IMEI must contain 14 to 16 digits.'));

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
		if (this.activeJob || this.downloadStarting)
			return;

		let request;

		try {
			request = this.collectRequest();
		}
		catch (error) {
			ui.addNotification(null, E('p', {}, [ error.message ]), 'error');
			return;
		}

		ui.showModal(_('Download eSIM profile'), [
			E('p', {}, [
				request.mode === 'activation'
					? _('Download and install the profile described by this activation code?')
					: _('Start profile download using the supplied manual parameters?')
			]),
			E('p', { 'class': 'cbi-value-description', 'role': 'note' }, [
				_('The operation can take several minutes. Keep the router online and do not start another eUICC operation until it finishes.')
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
				}, [ _('Download') ])
			])
		]);
	},

	startDownload: function(request) {
		if (this.activeJob || this.downloadStarting)
			return;

		this.downloadStarting = true;
		ui.showModal(_('Downloading eSIM profile'), [
			E('p', { 'class': 'spinning' }, [ _('Waiting for lpac…') ]),
			E('p', { 'class': 'cbi-value-description' }, [
				_('The page will update automatically when the download finishes.')
			])
		]);

		return lpac.downloadProfile(
			request.mode,
			request.activationCode,
			request.smdp,
			request.matchingId,
			request.imei,
			request.confirmationCode
		).then(function(result) {
			if (!result || !result.success || !Number.isInteger(result.data?.job_id) ||
			    result.data.job_id < 1)
				throw new Error(lpac.errorMessage(result));

			this.activeJob = result.data.job_id;
			this.downloadStarting = false;
		}.bind(this)).catch(function(error) {
			this.downloadStarting = false;
			ui.hideModal();
			ui.addNotification(null, E('p', {}, [ error.message ]), 'error');
		}.bind(this));
	},

	pollDownload: function() {
		if (!this.activeJob)
			return Promise.resolve();

		const jobId = this.activeJob;

		return lpac.getDownloadStatus(jobId).then(function(result) {
			if (result && result.success && result.data?.status === 'running')
				return;

			if (result?.error === 'transport_error')
				return;

			this.activeJob = null;
			ui.hideModal();

			if (result && result.success && result.data?.status === 'success') {
				this.clearForm();
				ui.addNotification(null, E('p', {}, [
					_('The eSIM profile was downloaded successfully. Open Profiles to verify and manage it.')
				]), 'info');
			}
			else {
				ui.addNotification(null, E('p', {}, [ lpac.errorMessage(result) ]), 'error');
			}
		}.bind(this)).catch(function() {
			/* Keep polling: the background lpac task may still be running. */
		});
	},

	render: function() {
		poll.add(this.pollDownload.bind(this), 2);

		const mode = E('select', {
			'id': 'lpac-download-mode',
			'class': 'cbi-input-select',
			'disabled': isReadonlyView,
			'change': this.updateMode.bind(this)
		}, [
			E('option', { 'value': 'activation', 'selected': '' }, [ _('Activation code or QR') ]),
			E('option', { 'value': 'manual' }, [ _('Manual parameters') ])
		]);
		const qrFile = E('input', {
			'id': 'lpac-qr-file',
			'class': 'cbi-input-file',
			'type': 'file',
			'accept': 'image/png,image/jpeg,image/webp',
			'capture': 'environment',
			'disabled': isReadonlyView,
			'change': function(event) {
				return this.handleQRFile(event.currentTarget);
			}.bind(this)
		});

		return E([
			E('h2', {}, [ _('Download eSIM profile') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Download and install a profile with the lpac profile download operation. Use a complete LPA activation code, import it from a QR image, or provide the non-interactive lpac parameters manually.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Download method') ]),
				formRow(_('Method'), mode)
			]),
			E('div', { 'id': 'lpac-download-activation-fields' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, [ _('Activation code') ]),
					formRow(_('LPA string'),
						textInput('lpac-activation-code', 'password',
							'LPA:1$smdp.example.com$MATCHING-ID', 4096),
						_('Paste the complete LPA string supplied by the provider.')),
					formRow(_('QR image'), qrFile,
						_('Select an eSIM QR image or use the device camera. Decoding happens locally in this browser.')),
					E('div', { 'class': 'cbi-value' }, [
						E('div', { 'class': 'cbi-value-title' }),
						E('div', { 'class': 'cbi-value-field' }, [
							E('img', {
								'id': 'lpac-qr-preview',
								'alt': _('Selected QR image preview'),
								'style': 'display:none;max-width:18rem;max-height:12rem'
							}),
							E('div', { 'id': 'lpac-qr-status', 'class': 'cbi-value-description' })
						])
					])
				])
			]),
			E('div', { 'id': 'lpac-download-manual-fields', 'style': 'display:none' }, [
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, [ _('Manual parameters') ]),
					formRow(_('SM-DP+ address'),
						textInput('lpac-smdp', 'text', 'smdp.example.com', 255),
						_('Optional. When empty, lpac uses the default SM-DP+ address configured on the eUICC.')),
					formRow(_('Matching ID'),
						textInput('lpac-matching-id', 'password', '', 255),
						_('Optional activation token passed to lpac with -m.'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Additional parameters') ]),
				formRow(_('Confirmation code'),
					textInput('lpac-confirmation-code', 'password', _('Optional'), 255),
					_('Provide this when the activation code or download order requires confirmation.')),
				formRow(_('IMEI'),
					textInput('lpac-imei', 'text', _('Optional'), 16),
					_('Optional 14- to 16-digit device identifier passed to lpac with -i.'))
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'disabled': isReadonlyView,
					'click': ui.createHandlerFn(this, 'clearForm')
				}, [ _('Clear') ]),
				' ',
				E('button', {
					'id': 'lpac-download-button',
					'class': 'btn cbi-button cbi-button-positive important',
					'disabled': isReadonlyView,
					'click': ui.createHandlerFn(this, 'showDownloadModal')
				}, [ _('Download profile') ])
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
