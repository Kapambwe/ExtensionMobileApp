export function isCompactViewport() {
    return window.innerWidth <= 768;
}

export function setLargeTextMode(enabled) {
    document.documentElement.classList.toggle('fieldops-large-text', Boolean(enabled));
}

export function setTallyMode(enabled) {
    document.documentElement.classList.toggle('fieldops-tally-mode', Boolean(enabled));
}
