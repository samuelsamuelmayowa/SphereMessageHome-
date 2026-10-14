// Set only after the listing is approved, public, and manually verified.
const APP_STORE_URL = "";
(() => {
    let listing;
    try {
        const url = new URL(APP_STORE_URL);
        if (url.protocol === "https:" && url.hostname === "apps.apple.com" && /\/id\d+/.test(url.pathname)) listing = url.href;
    } catch { /* iOS launch remains in progress. */ }
    if (listing) document.querySelectorAll('[data-ios-download]').forEach(status => {
        const link = document.createElement('a');
        link.href = listing;
        link.className = status.className;
        link.textContent = 'Download on the App Store';
        status.replaceWith(link);
    });
    if (listing) document.querySelectorAll('[data-ios-availability]').forEach(text => {
        text.textContent = 'Download SphereMessage for iPhone on the App Store or for Android on Google Play.';
    });
    if (listing) document.querySelectorAll('[data-ios-waitlist]').forEach(section => { section.hidden = true; });
})();
