// Global variables for camera transforms
let isFlippedHorizontal = false;
let isFlippedVertical = false;

// Function to get crosshair position from SVG
function getCrosshairPosition() {
    const svg = document.querySelector('.img-overlay-wrap svg');
    const circle = svg.querySelector('circle');
    return {
        x: parseFloat(circle.getAttribute('cx')),
        y: parseFloat(circle.getAttribute('cy'))
    };
}

// Function to calculate zoom origin based on crosshair
function calculateZoomOrigin() {
    const crosshair = getCrosshairPosition();
    // Convert SVG coordinates (200x200) to percentages
    const xPercent = (crosshair.x / 200) * 100;
    const yPercent = (crosshair.y / 200) * 100;
    return { x: xPercent, y: yPercent };
}

// Function to update transform with all transformations
function updateTransform() {
    const zoomImage = document.getElementById('zoom-image');
    const zoomSlider = document.getElementById('zoom-range');
    const scale = 1 + (parseInt(zoomSlider.value) / 100);
    const scaleX = isFlippedHorizontal ? -scale : scale;
    const scaleY = isFlippedVertical ? -scale : scale;
    
    // Get zoom origin based on crosshair position
    const origin = calculateZoomOrigin();
    
    // Set transform origin to crosshair position
    zoomImage.style.transformOrigin = `${origin.x}% ${origin.y}%`;
    
    // Apply scale transform without translate
    zoomImage.style.transform = `scale(${scaleX}, ${scaleY})`;
}

// Set both flip states, update the buttons and re-apply the transform
function setFlip(horizontal, vertical) {
    isFlippedHorizontal = !!horizontal;
    isFlippedVertical = !!vertical;

    $('#flip-horizontal')
        .toggleClass('btn-primary', isFlippedHorizontal)
        .toggleClass('btn-secondary', !isFlippedHorizontal);
    $('#flip-vertical')
        .toggleClass('btn-primary', isFlippedVertical)
        .toggleClass('btn-secondary', !isFlippedVertical);

    updateTransform();
    if (typeof updateJogHint === 'function') updateJogHint();
}

$(document).ready(function() {
    //Zoom
    const zoomImage = document.getElementById('zoom-image');
    const zoomSlider = document.getElementById('zoom-range');

    // Zoom event listener (value remembered between sessions)
    zoomSlider.value = AxiscopeSettings.get('zoom', zoomSlider.value);
    zoomSlider.addEventListener('input', () => {
        updateTransform();
    });
    zoomSlider.addEventListener('change', () => {
        AxiscopeSettings.set('zoom', zoomSlider.value);
    });

    // Flip controls event listeners (saved per camera)
    function saveFlip() {
        AxiscopeSettings.setCamera(currentCameraUrl, {
            flipH: isFlippedHorizontal,
            flipV: isFlippedVertical
        });
    }

    document.getElementById('flip-horizontal').addEventListener('click', () => {
        setFlip(!isFlippedHorizontal, isFlippedVertical);
        saveFlip();
    });

    document.getElementById('flip-vertical').addEventListener('click', () => {
        setFlip(isFlippedHorizontal, !isFlippedVertical);
        saveFlip();
    });

    // Set initial transform
    updateTransform();
    //Contrast
    const img = document.getElementById('zoom-image');
    const slider = document.getElementById('contrast-range');

    function updateContrast() {
      const value = slider.value;
      img.style.filter = `contrast(${value}%)`;
    }
    slider.value = AxiscopeSettings.get('contrast', slider.value);
    slider.addEventListener('input', updateContrast);
    slider.addEventListener('change', () => {
        AxiscopeSettings.set('contrast', slider.value);
    });
    updateContrast();

    //LED brightness (Ember Prototype V2 camera, optional)
    const ledSlider = document.getElementById('led-range');
    let ledSendTimeout = null;

    function sendLedValue(value) {
        const pwm = (value / 100).toFixed(3);
        $.get(printerUrl(printerIp, '/printer/gcode/script?script=' +
            encodeURIComponent('AXISCOPE_SET_LED VALUE=' + pwm)))
            .fail(function() {
                console.error('Failed to set LED brightness');
            });
    }

    ledSlider.addEventListener('pointerdown', () => {
        isLedSliderActive = true;
    });

    ledSlider.addEventListener('input', () => {
        clearTimeout(ledSendTimeout);
        ledSendTimeout = setTimeout(() => sendLedValue(ledSlider.value), 200);
    });

    ledSlider.addEventListener('pointerup', () => {
        isLedSliderActive = false;
    });
});