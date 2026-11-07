// Camera-centric jogging: arrow buttons around the camera move the nozzle in
// the direction you click, as seen in the (possibly flipped) camera image.
//
// The mapping from image direction to printer axis depends on how the camera
// is mounted, so it is learned once per camera with a short calibration and
// stored relative to the *unflipped* image. Flip H / Flip V are applied on top,
// so toggling a flip keeps the arrows correct without recalibrating.

const JOG_STEPS = [0.01, 0.05, 0.1, 0.5, 1];
const JOG_DEFAULT_STEP = 0.1;
const JOG_DEFAULT_MAP = { right: { axis: 'X', sign: 1 }, up: { axis: 'Y', sign: 1 } };
const CALIBRATION_DISTANCE = 0.5;

let jogStep = JOG_DEFAULT_STEP;
let calibration = null; // { stage: 'X' | 'Y', answers: {} } while calibrating
let bannerTimeout = null;

function flipSigns() {
    return {
        h: isFlippedHorizontal ? -1 : 1,
        v: isFlippedVertical ? -1 : 1
    };
}

function isJogCalibrated() {
    return !!AxiscopeSettings.getCamera(currentCameraUrl).jog;
}

// Mapping as it applies to the image currently on screen (flips applied)
function getDisplayedJogMap() {
    const raw = AxiscopeSettings.getCamera(currentCameraUrl).jog || JOG_DEFAULT_MAP;
    const f = flipSigns();
    return {
        right: { axis: raw.right.axis, sign: raw.right.sign * f.h },
        up:    { axis: raw.up.axis,    sign: raw.up.sign * f.v }
    };
}

function jogVector(dir) {
    const map = getDisplayedJogMap();
    switch (dir) {
        case 'right': return { axis: map.right.axis, sign: map.right.sign };
        case 'left':  return { axis: map.right.axis, sign: -map.right.sign };
        case 'up':    return { axis: map.up.axis,    sign: map.up.sign };
        case 'down':  return { axis: map.up.axis,    sign: -map.up.sign };
    }
    return null;
}

function updateJogHint() {
    ['up', 'down', 'left', 'right'].forEach(dir => {
        const v = jogVector(dir);
        $(`.jog-btn[data-jog="${dir}"] .jog-label`).text((v.sign > 0 ? '+' : '-') + v.axis);
    });

    const $cal = $('#jog-calibrate');
    if (isJogCalibrated()) {
        $cal.removeClass('btn-warning').addClass('btn-outline-secondary')
            .html('<i class="bi bi-compass"></i> Recalibrate directions');
    } else {
        $cal.removeClass('btn-outline-secondary').addClass('btn-warning')
            .html('<i class="bi bi-compass"></i> Calibrate directions');
    }
}

function showJogBanner(html, autoHideMs) {
    clearTimeout(bannerTimeout);
    $('#jog-banner').html(html).removeClass('d-none');
    if (autoHideMs) {
        bannerTimeout = setTimeout(hideJogBanner, autoHideMs);
    }
}

function hideJogBanner() {
    clearTimeout(bannerTimeout);
    $('#jog-banner').addClass('d-none').empty();
}

function gcodeRequest(script) {
    return $.get(printerUrl(printerIp, '/printer/gcode/script?script=' + encodeURIComponent(script)));
}

// Plain relative move (no backlash bounce) - used for calibration
function relativeMove(axis, value) {
    return gcodeRequest([
        'SAVE_GCODE_STATE NAME=axiscope_jog',
        'G91',
        `G0 ${axis}${value} F1200`,
        'RESTORE_GCODE_STATE NAME=axiscope_jog'
    ].join('\n'));
}

function jogMove(dir) {
    if (!printerIp) return;
    const v = jogVector(dir);
    const value = Math.round(v.sign * jogStep * 1000) / 1000;
    // Same bounce (backlash take-up) move as the axis buttons
    $.get(printerUrl(printerIp, '/printer/gcode/script?script=' + ComandsUrl(v.axis, value)));
}

// ---------------- Calibration ----------------

function calibrationFailed() {
    calibration = null;
    $('.jog-btn').removeClass('jog-calibrating');
    showJogBanner(
        'Move failed. Is the printer homed? ' +
        '<button type="button" class="btn btn-sm btn-light ms-2" id="jog-calibrate-cancel">Close</button>'
    );
}

function promptCalibrationStage(axis) {
    calibration.stage = axis;
    showJogBanner(
        `<div><strong>Step ${axis === 'X' ? 1 : 2} of 2:</strong> moving the nozzle <strong>+${axis}</strong> ${CALIBRATION_DISTANCE} mm…</div>` +
        `<div>Click the arrow (or press the arrow key) for the direction the nozzle moved <em>in the image</em>.</div>` +
        '<button type="button" class="btn btn-sm btn-light mt-1" id="jog-calibrate-cancel">Cancel</button>'
    );
    relativeMove(axis, CALIBRATION_DISTANCE).fail(calibrationFailed);
}

function startCalibration() {
    if (!printerIp) return;
    calibration = { stage: 'X', answers: {} };
    $('.jog-btn').addClass('jog-calibrating');
    promptCalibrationStage('X');
}

function cancelCalibration() {
    calibration = null;
    $('.jog-btn').removeClass('jog-calibrating');
    hideJogBanner();
}

function answerCalibration(dir) {
    const axis = calibration.stage;
    calibration.answers[axis] = dir;

    // Move back to where we started before doing anything else
    const back = relativeMove(axis, -CALIBRATION_DISTANCE);

    if (axis === 'X') {
        back.done(() => { if (calibration) promptCalibrationStage('Y'); })
            .fail(calibrationFailed);
        return;
    }

    const answers = calibration.answers;
    const horizontal = d => d === 'left' || d === 'right';
    if (horizontal(answers.X) === horizontal(answers.Y)) {
        calibration = null;
        $('.jog-btn').removeClass('jog-calibrating');
        showJogBanner(
            'X and Y should move in perpendicular directions in the image. ' +
            '<button type="button" class="btn btn-sm btn-light ms-2" id="jog-calibrate-retry">Try again</button>' +
            '<button type="button" class="btn btn-sm btn-outline-light ms-1" id="jog-calibrate-cancel">Cancel</button>'
        );
        return;
    }

    // Build the mapping for the displayed image, then convert it to the raw
    // (unflipped) image so later flip toggles stay correct.
    const f = flipSigns();
    const raw = {};
    ['X', 'Y'].forEach(a => {
        const d = answers[a];
        if (horizontal(d)) {
            raw.right = { axis: a, sign: (d === 'right' ? 1 : -1) * f.h };
        } else {
            raw.up = { axis: a, sign: (d === 'up' ? 1 : -1) * f.v };
        }
    });

    AxiscopeSettings.setCamera(currentCameraUrl, { jog: raw });
    calibration = null;
    $('.jog-btn').removeClass('jog-calibrating');
    updateJogHint();
    showJogBanner('<i class="bi bi-check-circle"></i> Directions saved for this camera.', 2500);
}

// ---------------- UI wiring ----------------

function handleJogDirection(dir) {
    if (calibration) {
        answerCalibration(dir);
    } else {
        jogMove(dir);
    }
}

$(document).ready(function() {
    // Step size selector
    const savedStep = parseFloat(AxiscopeSettings.get('jogStep', JOG_DEFAULT_STEP));
    jogStep = JOG_STEPS.includes(savedStep) ? savedStep : JOG_DEFAULT_STEP;

    const $steps = $('#jog-steps');
    JOG_STEPS.forEach(step => {
        $('<button>', {
            type: 'button',
            class: 'btn btn-outline-secondary' + (step === jogStep ? ' active' : ''),
            'data-step': step,
            text: step
        }).appendTo($steps);
    });

    $steps.on('click', 'button', function() {
        jogStep = parseFloat($(this).attr('data-step'));
        AxiscopeSettings.set('jogStep', jogStep);
        $steps.find('button').removeClass('active');
        $(this).addClass('active');
    });

    $(document).on('click', '.jog-btn', function() {
        handleJogDirection($(this).attr('data-jog'));
    });

    $('#jog-calibrate').on('click', startCalibration);
    $(document).on('click', '#jog-calibrate-cancel', cancelCalibration);
    $(document).on('click', '#jog-calibrate-retry', startCalibration);

    // Arrow keys jog too (ignored while typing or while the modal is open)
    const keyDirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    $(document).on('keydown', function(e) {
        const dir = keyDirs[e.key];
        if (!dir || !printerIp) return;
        if ($(e.target).is('input, textarea, select, [contenteditable]')) return;
        if ($('#printerModal').hasClass('show')) return;
        e.preventDefault();
        if (e.repeat) return;
        handleJogDirection(dir);
    });

    updateJogHint();
});
