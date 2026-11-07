// Global variables and utility functions
let printerIp = '';
let updateInterval = null;
let currentCameraUrl = null;   // stream URL of the connected camera
let selectedCamera = null;     // camera picked in the modal: {url, flipH, flipV}

function printerUrl(ip, endpoint) {
    ip = ip.replace(/^https?:\/\//, '');
    return `http://${ip}${endpoint}`;
}

function isValidIP(input) {
    input = input.trim();
    if (!input) return false;

    input = input.replace(/^https?:\/\//, '');
    
    const urlRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9](:[0-9]+)?$/;
    return urlRegex.test(input);
}

function updatePage() {
  $.get(printerUrl(printerIp,"/printer/objects/query?gcode_move&toolhead&toolchanger&quad_gantry_level&stepper_enable&axiscope"), function(data){
    // console.log(printerUrl)
    if (data['result']) {

      var positions   = data['result']['status']['gcode_move']['position'];
      var gcode_pos   = data['result']['status']['gcode_move']['gcode_position'];
      var homed       = data['result']['status']['toolhead']['homed_axes'] == "xyz";
      var qgl_done    = data['result']['status']['quad_gantry_level']['applied'];
      var steppers    = data['result']['status']['stepper_enable']['steppers'];
      // var initialized = data['result']['status']['toolchanger']['status'] == "ready";
      var tool_number = data['result']['status']['toolchanger']['tool_number'];
      var tools       = data['result']['status']['toolchanger']['tool_numbers'];

      var axis_min    = data['result']['status']['toolhead']['axis_minimum'];
      var axis_max    = data['result']['status']['toolhead']['axis_maximum'];
      var axiscope    = data['result']['status']['axiscope'];

      updatePositions(positions, gcode_pos);
      updateHoming(homed);
      updateQGL(qgl_done);
      updateMotor(checkActiveStepper(steppers));
      updateTools(tools, tool_number);
      updateBedMap(axiscope, axis_min, axis_max, gcode_pos);
      updateLedControl(axiscope);
    }
  });
}

let isLedSliderActive = false;

function updateLedControl(axiscope) {
    const $ledControl = $('#led-control');
    const $ledSlider = $('#led-range');

    if (!axiscope || !axiscope.has_led) {
        $ledControl.hide();
        return;
    }

    $ledControl.show();

    // Avoid fighting the user while they are actively dragging the slider
    if (!isLedSliderActive) {
        $ledSlider.val(Math.round(axiscope.led_value * 100));
    }
}

function updateBedMap(axiscope, axis_min, axis_max, gcode_pos) {
    if (!axiscope || !axis_min || !axis_max) {
        $('#endstop-section').hide();
        return;
    }
    $('#endstop-section').show();

    const svg = document.getElementById('bed-map-svg');
    if (!svg) return;

    const pad    = 24;
    const maxDim = 200; // max pixels for the longer axis

    const minX = axis_min[0], maxX = axis_max[0];
    const minY = axis_min[1], maxY = axis_max[1];
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Scale so the longer axis = maxDim, shorter axis scales proportionally
    const scale  = maxDim / Math.max(rangeX, rangeY);
    const W      = Math.round(rangeX * scale) + pad * 2;
    const H      = Math.round(rangeY * scale) + pad * 2;
    const drawW  = W - pad * 2;
    const drawH  = H - pad * 2;

    svg.setAttribute('width',  W);
    svg.setAttribute('height', H);

    // Map a printer coordinate to SVG space (Y axis flipped)
    function toSVG(px, py) {
        return [
            pad + ((px - minX) / rangeX) * drawW,
            pad + ((maxY - py) / rangeY) * drawH
        ];
    }

    // Clear and redraw
    svg.innerHTML = '';

    // Bed boundary
    const [bx1, by1] = toSVG(minX, maxY);
    const [bx2, by2] = toSVG(maxX, minY);
    const bedRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bedRect.setAttribute('x', bx1);
    bedRect.setAttribute('y', by1);
    bedRect.setAttribute('width', bx2 - bx1);
    bedRect.setAttribute('height', by2 - by1);
    bedRect.setAttribute('fill', 'none');
    bedRect.setAttribute('stroke', '#555');
    bedRect.setAttribute('stroke-width', '1');
    svg.appendChild(bedRect);

    // Corner labels
    function addLabel(text, x, y, anchor) {
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x); t.setAttribute('y', y);
        t.setAttribute('text-anchor', anchor);
        t.setAttribute('font-size', '8');
        t.setAttribute('fill', '#888');
        t.textContent = text;
        svg.appendChild(t);
    }
    addLabel(`${minX},${maxY}`, bx1 + 2,  by1 + 10, 'start');
    addLabel(`${maxX},${maxY}`, bx2 - 2,  by1 + 10, 'end');
    addLabel(`${minX},${minY}`, bx1 + 2,  by2 - 3,  'start');
    addLabel(`${maxX},${minY}`, bx2 - 2,  by2 - 3,  'end');

    // Endstop position marker (green crosshair)
    if (axiscope.endstop_x !== null && axiscope.endstop_y !== null) {
        const [ex, ey] = toSVG(axiscope.endstop_x, axiscope.endstop_y);
        const r = 5;

        const hLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hLine.setAttribute('x1', ex - r); hLine.setAttribute('y1', ey);
        hLine.setAttribute('x2', ex + r); hLine.setAttribute('y2', ey);
        hLine.setAttribute('stroke', '#22c55e'); hLine.setAttribute('stroke-width', '1.5');
        svg.appendChild(hLine);

        const vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        vLine.setAttribute('x1', ex); vLine.setAttribute('y1', ey - r);
        vLine.setAttribute('x2', ex); vLine.setAttribute('y2', ey + r);
        vLine.setAttribute('stroke', '#22c55e'); vLine.setAttribute('stroke-width', '1.5');
        svg.appendChild(vLine);

        const endLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        endLabel.setAttribute('x', ex + 6); endLabel.setAttribute('y', ey - 4);
        endLabel.setAttribute('font-size', '8'); endLabel.setAttribute('fill', '#22c55e');
        endLabel.textContent = `Z-switch (${axiscope.endstop_x.toFixed(1)}, ${axiscope.endstop_y.toFixed(1)})`;
        svg.appendChild(endLabel);
    }

    // Current nozzle position marker (blue dot)
    if (gcode_pos) {
        const [cx, cy] = toSVG(gcode_pos[0], gcode_pos[1]);

        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
        dot.setAttribute('r', '4');
        dot.setAttribute('fill', '#3b82f6');
        dot.setAttribute('fill-opacity', '0.8');
        svg.appendChild(dot);

        const posLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        posLabel.setAttribute('x', cx + 6); posLabel.setAttribute('y', cy + 4);
        posLabel.setAttribute('font-size', '8'); posLabel.setAttribute('fill', '#3b82f6');
        posLabel.textContent = `(${gcode_pos[0].toFixed(1)}, ${gcode_pos[1].toFixed(1)})`;
        svg.appendChild(posLabel);
    }
}

function updatePositions(positions, gcode_pos){
  if ($("#pos-x").text() != gcode_pos[0].toFixed(3)){
    $("#pos-x").text(gcode_pos[0].toFixed(3));
  }
  if ($("#pos-y").text() != gcode_pos[1].toFixed(3)){
    $("#pos-y").text(gcode_pos[1].toFixed(3));
  }
  if ($("#pos-z").text() != gcode_pos[2].toFixed(3)){
    $("#pos-z").text(gcode_pos[2].toFixed(3));
  }
}

function updateHoming(homed) {
    // Always update the data attribute first
    $("#home-all").data("homed", homed);

    // Force update the button states
    if (homed) {
        replaceClass("#home-all", "btn-danger", "btn-primary");
        replaceClass("#home-fine-x", "btn-dark", "btn-primary");
        replaceClass("#home-fine-y", "btn-dark", "btn-primary");
        replaceClass("#home-course-x", "btn-dark", "btn-primary");
        replaceClass("#home-course-y", "btn-dark", "btn-primary");
        replaceClass("#home-course-z", "btn-dark", "btn-primary");
    } else {
        replaceClass("#home-all", "btn-primary", "btn-danger");
        replaceClass("#home-fine-x", "btn-primary", "btn-dark");
        replaceClass("#home-fine-y", "btn-primary", "btn-dark");
        replaceClass("#home-course-x", "btn-primary", "btn-dark");
        replaceClass("#home-course-y", "btn-primary", "btn-dark");
        replaceClass("#home-course-z", "btn-primary", "btn-dark");
    }
}

function updateQGL(qgl_done) {
    // Always update the data attribute first
    $("#qgl").data("qgl", qgl_done);

    // Force update the button state
    if (qgl_done) {
        replaceClass("#qgl", "btn-danger", "btn-primary");
    } else {
        replaceClass("#qgl", "btn-primary", "btn-danger");
    }
}

function updateMotor(enabled) {
    // Always update the data attribute first
    $("#disable-motors").data("motoron", enabled);

    // Force update the button state
    if (enabled) {
        replaceClass("#disable-motors", "btn-danger", "btn-primary");
    } else {
        replaceClass("#disable-motors", "btn-primary", "btn-danger");
    }
}

function checkActiveStepper(array) {
  var result = false;

  $.each(array, function(key, value) {
      if (value === true) {
          result = true;
          return false;
      }
  });

  return result;
}

function replaceClass(id, old_class, new_class) {
  if ($(id).hasClass(old_class)) {
    $(id).removeClass(old_class);
    $(id).addClass(new_class);
  }
}

const bouncesComands = [
    'SAVE_GCODE_STATE NAME=bounce_move',
    'G91',
    '-bounce-',
    'RESTORE_GCODE_STATE NAME=bounce_move'
];
function ComandsUrl(axis, value) {
    let url = "";
    let bounce, move;
    
    if(value > 0){
        bounce = value + .5;
        move = -.5;
    } else {
        bounce = value - .5;
        move = .5;
    }
    bounce = parseFloat(bounce.toFixed(3));
    
    $.each(bouncesComands, function(k, comand){
        if(comand == '-bounce-')
            url += 'G0 '+axis+bounce+ ' F500%0AG0 '+axis+move+' F500%0A';
        else
            url += comand +"%0A";
    });
    return url;
}

// Event handlers for printer modal
// Macro management
function saveMacro() {
    const name = $('#macro-name').val().trim();
    const command = $('#macro-command').val().trim();
    
    if (!name || !command) {
        console.log('Both name and command are required');
        return;
    }
    
    // Get existing macros or initialize empty array
    let macros = JSON.parse(localStorage.getItem('axiscope_macros') || '[]');
    
    // Add new macro
    macros.push({ name, command });
    
    // Save to localStorage
    localStorage.setItem('axiscope_macros', JSON.stringify(macros));
    
    // Clear inputs
    $('#macro-name').val('');
    $('#macro-command').val('');
    
    // Refresh macro list
    loadMacros();
}

function loadMacros() {
    const macros = JSON.parse(localStorage.getItem('axiscope_macros') || '[]');
    const $macroList = $('#macro-list');
    
    // Clear current list
    $macroList.empty();
    
    // Add each macro as a button
    macros.forEach((macro, index) => {
        const $item = $(`
            <div class="list-group-item d-flex justify-content-between align-items-center">
                <button 
                    type="button" 
                    class="btn btn-sm btn-secondary flex-grow-1 me-2"
                    onclick="executeMacro(${index})"
                >
                    ${macro.name}
                </button>
                <button 
                    type="button" 
                    class="btn btn-sm btn-danger"
                    onclick="deleteMacro(${index})"
                >
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `);
        $macroList.append($item);
    });
}

function executeMacro(index) {
    const macros = JSON.parse(localStorage.getItem('axiscope_macros') || '[]');
    const macro = macros[index];
    
    if (!macro) return;
    
    const url = printerUrl(printerIp, `/printer/gcode/script?script=${encodeURIComponent(macro.command)}`);
    
    $.get(url)
        .done(function() {
            console.log(`Executed macro: ${macro.name}`);
        })
        .fail(function(error) {
            console.error(`Failed to execute macro: ${macro.name}`, error);
        });
}

function deleteMacro(index) {
    let macros = JSON.parse(localStorage.getItem('axiscope_macros') || '[]');
    
    macros.splice(index, 1);
    localStorage.setItem('axiscope_macros', JSON.stringify(macros));
    
    loadMacros();
}

// Show a status message in the printer modal. Errors force the modal open so a
// failed auto-connect on page load is still visible.
function showConnectStatus(message, isError) {
    $('#ipError')
        .toggleClass('text-danger', !!isError)
        .toggleClass('text-success', !isError)
        .text(message)
        .show();
    if (isError && !$('#printerModal').hasClass('show')) {
        $('#printerModal').modal('show');
    }
}

function resolveStreamUrl(ip, streamUrl) {
    try {
        new URL(streamUrl);
        return streamUrl; // Already a full URL (e.g. remote camera)
    } catch (e) {
        return printerUrl(ip, streamUrl); // Just a path - prefix the printer IP
    }
}

// Connect to Moonraker and list cameras. If autoCameraUrl matches one of the
// printer's cameras, connect to it straight away.
function connectPrinter(ip, autoCameraUrl) {
    ip = ip.trim().replace(/^https?:\/\//, '');
    if (!isValidIP(ip)) {
        showConnectStatus('Invalid IP address format', true);
        return;
    }

    const $btn = $('#saveIpBtn');
    const resetButton = () => $btn.prop('disabled', false).text('Retry Connection');
    $btn.prop('disabled', true)
        .html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Connecting...');

    $.ajax({ url: printerUrl(ip, '/server/info'), timeout: 5000 }).done(function(con_data) {
        if (!(con_data['result'] && con_data['result']['klippy_connected'])) {
            showConnectStatus('Printer is not ready. Please check if Klippy is connected.', true);
            resetButton();
            return;
        }

        showConnectStatus('Connected successfully!', false);
        $('#printerIp').val(ip).prop('disabled', true);
        $('#disconnectBtn').show();

        $.get(printerUrl(ip, '/server/webcams/list')).done(function(cam_data) {
            const cams = cam_data['result'] && cam_data['result']['webcams'];
            if (!cams) {
                showConnectStatus('Error fetching camera list', true);
                resetButton();
                return;
            }
            if (cams.length === 0) {
                showConnectStatus('No cameras found on this printer', true);
                resetButton();
                return;
            }

            const $cameraList = $('#cameraList');
            $cameraList.empty();

            cams.forEach(function(cam) {
                const streamUrl = resolveStreamUrl(ip, cam.stream_url);
                const snapshotUrl = streamUrl.replace('?action=stream', '?action=snapshot');

                $cameraList.append(`
                    <div class="camera-option p-2"
                         data-url="${streamUrl}"
                         data-flip-h="${cam.flip_horizontal}"
                         data-flip-v="${cam.flip_vertical}"
                    >
                        <div class="d-flex align-items-center">
                            <div class="me-3">
                                <img src="${snapshotUrl}" class="camera-preview" alt="${cam.name}">
                            </div>
                            <div>
                                <h6 class="mb-0">${cam.name}</h6>
                                <small class="text-muted">Click to select, double-click to connect</small>
                            </div>
                        </div>
                    </div>`);
            });

            $('#camera-select').show();
            $btn.html('Select Camera').prop('disabled', true)
                .removeClass('btn-primary').addClass('btn-success');

            if (autoCameraUrl) {
                const $match = $('.camera-option').filter(function() {
                    return $(this).data('url') === autoCameraUrl;
                });
                if ($match.length) {
                    selectCameraOption($match.first());
                    connectCamera(ip, selectedCamera);
                    return;
                }
                showConnectStatus('Saved camera not found - please select a camera', true);
            }
        }).fail(function(error) {
            console.error('Failed to fetch cameras:', error);
            showConnectStatus('Could not fetch camera list from printer', true);
            resetButton();
        });
    }).fail(function(error) {
        console.error('Connection failed:', error);
        $('#printerIp').prop('disabled', false);
        showConnectStatus('Could not connect to printer. Please check the IP address and ensure the printer is online.', true);
        resetButton();
    });
}

function selectCameraOption($option) {
    $('.camera-option').removeClass('selected');
    $option.addClass('selected');
    selectedCamera = {
        url: $option.data('url'),
        flipH: $option.data('flip-h') === true,
        flipV: $option.data('flip-v') === true
    };
    $('#saveIpBtn')
        .html('Connect to Camera')
        .prop('disabled', false)
        .removeClass('btn-success')
        .addClass('btn-primary');
}

function connectCamera(ip, cam) {
    // Stop any existing update interval
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    if (typeof cancelCalibration === 'function') cancelCalibration();

    printerIp = ip;
    currentCameraUrl = cam.url;

    // Remember for next time
    AxiscopeSettings.set('printerIp', ip);
    AxiscopeSettings.set('cameraUrl', cam.url);

    // Saved flips win over Moonraker's camera defaults
    const saved = AxiscopeSettings.getCamera(cam.url);
    const flipH = saved.flipH !== undefined ? saved.flipH : cam.flipH;
    const flipV = saved.flipV !== undefined ? saved.flipV : cam.flipV;

    $('#zoom-image').attr('src', cam.url);
    setFlip(flipH, flipV);

    // Initialize button URLs and data attributes
    $("#home-all")
        .attr("data-url", printerUrl(printerIp, '/printer/gcode/script?script=G28'))
        .attr("data-homed", "false")
        .addClass("btn-danger").removeClass("btn-primary");

    $("#qgl")
        .attr("data-url", printerUrl(printerIp, '/printer/gcode/script?script=QUAD_GANTRY_LEVEL'))
        .attr("data-qgl", "false")
        .addClass("btn-danger").removeClass("btn-primary");

    $("#disable-motors")
        .attr("data-url", printerUrl(printerIp, '/printer/gcode/script?script=M84'))
        .attr("data-motoron", "false")
        .addClass("btn-danger").removeClass("btn-primary");

    // Show the camera and jog pad
    $('#jogFrame').removeClass('d-none');

    $('#printerModal').modal('hide');

    initializePositionBars();
    updateJogHint();

    // Start the update cycle
    updatePage();
    getTools();
    updateInterval = setInterval(updatePage, 1000);
}

$(document).ready(function() {
    $("#ChangePrinter").click(function(){
        $('#printerModal').modal('show');
    });

    // Use the saved printer if there is one, otherwise the current host
    const savedIp = AxiscopeSettings.get('printerIp', '');
    $('#printerIp').val(savedIp || window.location.hostname);

    if (savedIp) {
        // Reconnect silently; the modal only appears if something fails
        connectPrinter(savedIp, AxiscopeSettings.get('cameraUrl', null));
    } else {
        $('#printerModal').modal('show');
    }

    // Handle IP input validation
    $('#printerIp').on('input', function() {
        const ip = $(this).val();
        if (ip && !isValidIP(ip)) {
            $('#ipError').removeClass('text-success').addClass('text-danger')
                .text('Invalid IP address format').show();
            $('#saveIpBtn').prop('disabled', true);
        } else {
            $('#ipError').hide();
            $('#saveIpBtn').prop('disabled', false);
        }
    });

    // Initialize macro list
    loadMacros();

    // Macro save button handler
    $('#save-macro').on('click', saveMacro);

    // Allow saving macro with Enter key in command input
    $('#macro-command').on('keypress', function(e) {
        if (e.which === 13) { // Enter key
            saveMacro();
        }
    });

    // Set endstop position button handler
    $('#set-endstop-position').on('click', function() {
        const url = printerUrl(printerIp, '/printer/gcode/script?script=' + encodeURIComponent('AXISCOPE_SET_ENDSTOP_POSITION CURRENT=1'));

        $.get(url)
            .done(function() {
                console.log('Set endstop position to current location');
                // Show success feedback
                const button = $('#set-endstop-position');
                const originalText = button.html();
                button.html('<i class="bi bi-check-circle"></i> Position Set!');
                button.removeClass('btn-success').addClass('btn-outline-success');

                setTimeout(function() {
                    button.html(originalText);
                    button.removeClass('btn-outline-success').addClass('btn-success');
                }, 2000);
            })
            .fail(function(error) {
                console.error('Failed to set endstop position:', error);
                // Show error feedback
                const button = $('#set-endstop-position');
                const originalText = button.html();
                button.html('<i class="bi bi-x-circle"></i> Failed');
                button.removeClass('btn-success').addClass('btn-danger');

                setTimeout(function() {
                    button.html(originalText);
                    button.removeClass('btn-danger').addClass('btn-success');
                }, 2000);
            });
    });

    function modalIp() {
        return $('#printerIp').val().trim().replace(/^https?:\/\//, '');
    }

    // Modal button: connect to the printer, or to the selected camera
    $('#saveIpBtn').on('click', function() {
        if (selectedCamera) {
            connectCamera(modalIp(), selectedCamera);
        } else {
            connectPrinter(modalIp());
        }
    });

    $(document).on('click', '.camera-option', function() {
        selectCameraOption($(this));
    });

    $(document).on('dblclick', '.camera-option', function() {
        selectCameraOption($(this));
        connectCamera(modalIp(), selectedCamera);
    });

    // Disconnect handler
    $('#disconnectBtn').on('click', function() {
        // Stop update interval
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        if (typeof cancelCalibration === 'function') cancelCalibration();

        // Reset global variables
        printerIp = '';
        currentCameraUrl = null;
        selectedCamera = null;

        $('#printerIp').prop('disabled', false);
        $(this).hide();
        $('#camera-select').hide();
        $('#jogFrame').addClass('d-none');
        $('#zoom-image').attr('src', '');

        // Reset button state
        $('#saveIpBtn').html('Save IP')
                       .prop('disabled', false)
                       .removeClass('btn-success btn-primary')
                       .addClass('btn-primary');

        $('#ipError').hide();
        $('#cameraList').empty();
        $('#BigPositionBar').empty();
    });
});

// Initialize position bars
function initializePositionBars() {
    const bounceMove = (axis, value) => printerUrl(printerIp, '/printer/gcode/script?script=' + ComandsUrl(axis,value));
    $('#BigPositionBar').empty();

    const $containerBigPos = $("#BigPositionBar");
    const axesBigPos = ["X", "Y", "Z"];
    
    axesBigPos.forEach(axis => {
        const $row = $('<div class="row pb-1"></div>');
        const $toolbar = $('<div class="btn-toolbar justify-content-center" role="toolbar" aria-label="Movement Toolbar"></div>');
        const $btnGroup = $('<div class="btn-group btn-group-sm ps-5 pe-5" role="group"></div>');

        const values = axis != "Z" ? [-50, -10, -5, -1] : [-25, -10, -1, -.1];
        values.forEach(value => {
            $('<button>', {
                type: "button",
                class: "btn btn-secondary border",
                "data-url": bounceMove(axis, value),
                text: value.toFixed(2)
            }).appendTo($btnGroup);
        });

        $('<button>', {
            type: "button",
            class: "btn btn-dark border border-dark",
            "data-url": printerUrl(printerIp, `/printer/gcode/script?script=G28${axis}`),
            id: `home-fine-${axis.toLowerCase()}`,
            text: axis
        }).appendTo($btnGroup);

        const reverseValues = axis != "Z" ? [50, 10, 5, 1].reverse() : [25, 10, 1, .1].reverse();
        reverseValues.forEach(value => {
            $('<button>', {
                type: "button",
                class: "btn btn-secondary border",
                "data-url": bounceMove(axis, value),
                text: `+${value.toFixed(2)}`
            }).appendTo($btnGroup);
        });

        $toolbar.append($btnGroup);
        $row.append($toolbar);
        $containerBigPos.append($row);
    });
}

// Button click handlers
$(document).on("click", "button", function(e) {
    if ($(this).data("url")) {
        const url = $(this).data("url");
        $.get(url, function(data){
            // TODO check if it worked
        });
    } else if ($(this).data("axis")){
        const tool = $(this).data("tool");
        const axis = $(this).data("axis");
        const position = $("#pos-"+axis).text();
        
        $("input[name=T"+tool+"-"+axis+"-pos]").val(position);
        updateOffset(tool, axis);
    } else if ($(this).is("#capture-pos")) {
        const x_pos = parseFloat($("#pos-x").text()).toFixed(3);
        const y_pos = parseFloat($("#pos-y").text()).toFixed(3);
        const z_pos = parseFloat($("#pos-z").text()).toFixed(3);

        $("#captured-x").find(">:first-child").text(x_pos);
        $("#captured-y").find(">:first-child").text(y_pos);
        $("#captured-z").find(">:first-child").text(z_pos);
    } else if ($(this).is("#toolchange")) {
        const url = toolChangeURL($(this).data("tool"));
        $.get(url, function(data){});
    }
});

// Input change handlers
$(document).on("change", "input[type=number]", function(e) {
    const tool = $(this).data("tool");
    const axis = $(this).data("axis");
    updateOffset(tool, axis);
});