const form = document.getElementById('delete-form');
const email = document.getElementById('account-email');
const code = document.getElementById('email-code');
const codeStep = document.getElementById('code-step');
const confirmationStep = document.getElementById('confirmation-step');
const confirmed = document.getElementById('confirm-delete');
const button = document.getElementById('submit-button');
const restart = document.getElementById('restart-button');
const message = document.getElementById('form-message');
const labels = { send: 'Send verification code', verify: 'Verify code', delete: 'Permanently delete account' };

let action = 'send';
let proof = '';
let deletionStarted = false;

function showStep(next) {
    action = next;
    email.readOnly = next !== 'send';
    codeStep.hidden = codeStep.disabled = next !== 'verify';
    confirmationStep.hidden = confirmationStep.disabled = next !== 'delete';
    restart.hidden = next === 'send' || deletionStarted;
    button.textContent = labels[next];
}

restart.addEventListener('click', () => {
    proof = '';
    code.value = '';
    confirmed.checked = false;
    message.textContent = '';
    showStep('send');
    email.focus();
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = restart.disabled = true;
    if (action === 'delete') {
        deletionStarted = true;
        restart.hidden = true;
    }
    message.textContent = action === 'delete' ? 'Deleting your account. Keep this page open.' : 'Please wait...';

    try {
        const payload = { action };
        if (action === 'send') payload.email = email.value;
        if (action === 'verify') Object.assign(payload, { proof, code: code.value });
        if (action === 'delete') Object.assign(payload, { proof, confirmed: confirmed.checked });

        const response = await fetch(form.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);

        if (action === 'send' && result.challenge) {
            proof = result.challenge;
            showStep('verify');
            message.textContent = 'If this email belongs to a SphereMessage account, a verification code is on its way.';
            code.focus();
        } else if (action === 'verify' && result.proof) {
            proof = result.proof;
            code.value = '';
            showStep('delete');
            message.textContent = 'Email verified. Confirm permanent deletion below.';
            confirmed.focus();
        } else if (action === 'delete' && result.deleted === true) {
            proof = '';
            form.reset();
            form.hidden = true;
            message.textContent = 'Your SphereMessage account has been deleted.';
        } else {
            throw new Error('Unexpected response. Please try again.');
        }
    } catch (error) {
        message.textContent = deletionStarted
            ? 'Deletion could not be confirmed. Keep this page open and try again. If it still fails, contact SphereMessage support.'
            : error.message || 'Something went wrong. Please try again.';
    } finally {
        button.disabled = restart.disabled = false;
    }
});

button.disabled = false;
