import Tesseract from 'tesseract.js';

// Configuración única de ROIs (zonas de interés) en coordenadas relativas
// respecto al contenedor visual `.bill-guide`. Estos mismos valores se usan:
// - Para recortar el canvas que se manda a Tesseract.
// - Para posicionar los cuadros visibles (.value-*, .serial-*) en la UI.
const ROI_CONFIG = [
    {
        id: 'value-top',
        name: 'Valor Superior',
        kind: 'valor',
        css: { top: 0.11, left: 0.04, width: 0.12, height: 0.26 },
        selector: '.value-top',
    },
    {
        id: 'value-bottom',
        name: 'Valor Inferior',
        kind: 'valor',
        css: { bottom: 0.10, left: 0.04, width: 0.12, height: 0.20 },
        selector: '.value-bottom',
    },
    {
        id: 'serial-top',
        name: 'Serie Superior (horizontal)',
        kind: 'serie',
        css: { top: 0.10, right: 0.07, width: 0.27, height: 0.11 },
        selector: '.serial-top',
    },
    {
        id: 'serial-bottom',
        name: 'Serie Inferior (horizontal)',
        kind: 'serie',
        css: { bottom: 0.12, left: 0.16, width: 0.38, height: 0.15 },
        selector: '.serial-bottom',
    },
];

// Zona amplia usada como fallback para mejorar probabilidad de lectura
const ZONA_COMPLETA_ROI = {
    id: 'zona-completa',
    name: 'Zona Completa',
    kind: 'mixto',
    css: { top: 0.04, left: 0.02, width: 0.96, height: 0.92 },
};

document.addEventListener('DOMContentLoaded', () => {
    // Elementos principales
    const startBtn   = document.getElementById('start-btn');
    const closeBtn   = document.getElementById('close-btn');
    const scanBtn    = document.getElementById('scan-btn');
    const resultCloseBtn = document.getElementById('result-close-btn');

    const fullscreen = document.getElementById('scanner-fullscreen');
    const video      = document.getElementById('webcam');
    const canvas     = document.getElementById('capture-canvas');
    const statusBadge = document.getElementById('scanner-status');
    const scanResult  = document.getElementById('scan-result');
    const ocrDetails  = document.getElementById('ocr-details');

    // Diálogo de ingreso manual
    const manualDialog    = document.getElementById('manual-dialog');
    const manualOpenBtn   = document.getElementById('manual-input-btn');
    const manualCloseBtn  = document.getElementById('manual-close-btn');
    const manualCancelBtn = document.getElementById('manual-cancel-btn');
    const manualSaveBtn   = document.getElementById('validar-manual');
    const manualValorEl   = document.getElementById('manual-valor');
    const manualSerieEl   = document.getElementById('manual-serie');

    let stream = null;

    // Sincronizar al cargar: los cuadros visibles se posicionan usando ROI_CONFIG
    applyGuideStylesFromRois();

    // ── Diálogo de ingreso manual ───────────────────────────────────────────
    function openManualDialog(prefill = {}) {
        // Limpiar selección previa
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        manualValorEl.value = '';

        if (prefill.valor) {
            manualValorEl.value = prefill.valor;
            const chip = document.querySelector(`.chip[data-value="${prefill.valor}"]`);
            if (chip) chip.classList.add('active');
        }
        if (prefill.serie) manualSerieEl.value = prefill.serie;
        manualDialog.style.display = 'flex';
    }

    function closeManualDialog() {
        manualDialog.style.display = 'none';
        // Resetear campos
        manualValorEl.value = '';
        manualSerieEl.value = '';
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    }

    manualOpenBtn.addEventListener('click', () => {
        // Podríamos en el futuro prellenar con el último OCR aquí
        openManualDialog();
    });

    // Lógica de selección de chips (denominación)
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            // Desactivar otros chips
            document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            // Activar este chip
            chip.classList.add('active');
            // Guardar el valor en el input oculto
            manualValorEl.value = chip.dataset.value;
        });
    });

    manualCloseBtn.addEventListener('click', closeManualDialog);
    manualCancelBtn.addEventListener('click', closeManualDialog);

    manualSaveBtn.addEventListener('click', () => {
        const valor = manualValorEl.value.trim();
        const serie = manualSerieEl.value.trim().toUpperCase();

        if (!valor || !serie) {
            alert('Completa la denominación y el número de serie.');
            return;
        }

        // Reflejamos la entrada manual en el panel de resultados
        const html = `
            <div class="ocr-item">
              <span class="ocr-label">Denominación (manual):</span>
              <span class="accent-text">Bs. ${valor}</span>
            </div>
            <div class="ocr-item">
              <span class="ocr-label">Nro de Serie (manual):</span>
              <span>${serie}</span>
            </div>
            <div class="ocr-item">
              <span class="ocr-label">Origen:</span>
              <span style="color:#38bdf8">Ingreso manual del usuario</span>
            </div>
        `;
        ocrDetails.innerHTML = html;
        scanResult.style.display = 'block';
        closeManualDialog();
    });

    // ── Abrir escáner fullscreen ────────────────────────────────────────────
    startBtn.addEventListener('click', async () => {
        const isSecure = window.isSecureContext;
        const protocol = window.location.protocol;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert(`No se puede acceder a la cámara en este navegador.

- Protocolo actual: ${protocol}
- Contexto seguro: ${isSecure ? 'SÍ (correcto)' : 'NO'}

Prueba esto:
1. Abre la web desde "https://" o desde "https://localhost".
2. Usa un navegador actualizado (Chrome, Edge, Safari).
3. Si estás en móvil, abre el enlace directamente en el navegador del sistema (no dentro de apps como WhatsApp).`);
            return;
        }

        try {
            statusBadge.textContent = 'Solicitando permisos de cámara...';
            statusBadge.style.color = '#fde68a';
            statusBadge.style.borderColor = '#fde68a';

            // Pedimos a la cámara una resolución alta (con fallback automático)
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width:  { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 }
                }
            });

            video.srcObject = stream;
            fullscreen.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            statusBadge.textContent = 'Cámara activa. Centra el billete en el recuadro.';
            statusBadge.style.color = '#4ade80';
            statusBadge.style.borderColor = '#4ade80';
        } catch (err) {
            console.error('Error detallado de cámara:', err);

            statusBadge.textContent = 'Error al activar la cámara';
            statusBadge.style.color = '#f87171';
            statusBadge.style.borderColor = '#f87171';

            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert(`¡Permiso de cámara denegado! 🚫

El navegador tiene bloqueada la cámara para este sitio.

Para solucionarlo:
1. Pulsa el ícono del candado (o "Configuración del sitio") junto a la URL.
2. Busca "Cámara".
3. Cámbiala a "Permitir".
4. Recarga la página y vuelve a intentarlo.`);
            } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
                alert('No se encontró una cámara compatible. Si estás en un PC sin cámara o está siendo usada por otra app, ciérrala y vuelve a intentar.');
            } else {
                alert(`Error al abrir la cámara: ${err.name}.

Asegúrate de:
- Aceptar el certificado HTTPS de Vite (opción "Avanzado > Continuar de todos modos").
- Permitir el acceso a la cámara cuando el navegador lo pida.`);
            }
        }
    });

    // ── Cerrar escáner fullscreen ───────────────────────────────────────────
    function closeScanner() {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        video.srcObject = null;
        fullscreen.style.display = 'none';
        scanResult.style.display = 'none';
        document.body.style.overflow = '';
        fullscreen.classList.remove('scanning');
        scanBtn.disabled = false;
        scanBtn.innerHTML = '<i class="fas fa-magnifying-glass"></i> Escanear Billete';
    }

    closeBtn.addEventListener('click', closeScanner);
    resultCloseBtn.addEventListener('click', () => {
        scanResult.style.display = 'none';
    });

    // Cerrar con tecla Escape (desktop)
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && stream) closeScanner();
    });

    // ── Capturar y escanear ─────────────────────────────────────────────────
    scanBtn.addEventListener('click', async () => {
        if (!stream) return;

        // UI: iniciando escaneo
        fullscreen.classList.add('scanning');
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        scanResult.style.display = 'none';
        scanResult.style.display = 'none';

        const ctx = canvas.getContext('2d');

        // Usamos las dimensiones reales del elemento de video para que el canvas
        // coincida con lo que el usuario ve en pantalla.
        const displayWidth  = video.videoWidth  || video.clientWidth;
        const displayHeight = video.videoHeight || video.clientHeight;

        canvas.width  = displayWidth;
        canvas.height = displayHeight;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            const vb = getVideoBounds(video, canvas);

            // ROIs: usamos la configuración común y añadimos la zona completa de fallback
            const rois = [...ROI_CONFIG, ZONA_COMPLETA_ROI];

            let combinedText = '';
            let zonaLines = null;
            let zonaSize  = null;

            for (const roi of rois) {
                const box = cssBoxToCanvasROI(vb, roi.css);
                if (box.w <= 10 || box.h <= 10) continue;

                const rc = document.createElement('canvas');
                rc.width  = Math.round(box.w);
                rc.height = Math.round(box.h);
                rc.getContext('2d').drawImage(
                    canvas,
                    Math.round(box.x), Math.round(box.y),
                    Math.round(box.w), Math.round(box.h),
                    0, 0, rc.width, rc.height
                );

                // Escalar para mejorar precisión OCR en zonas pequeñas
                const sc = document.createElement('canvas');
                const factor = Math.max(1, Math.min(4, 300 / Math.min(rc.width, rc.height)));
                sc.width  = rc.width  * factor;
                sc.height = rc.height * factor;
                const sCtx = sc.getContext('2d');
                sCtx.imageSmoothingQuality = 'high';
                sCtx.drawImage(rc, 0, 0, sc.width, sc.height);

                // Configurar OCR según el tipo de zona (valor / serie / mixto)
                const whitelist =
                    roi.kind === 'valor'
                        ? '0123456789'
                        : roi.kind === 'serie'
                            ? '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ '
                            : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ';

                const result = await Tesseract.recognize(
                    sc.toDataURL('image/jpeg', 0.95),
                    'eng',
                    {
                        tessedit_char_whitelist: whitelist,
                    }
                );
                combinedText += `\n[${roi.name}]: ${result.data.text.trim()}`;

                if (roi.id === 'zona-completa') {
                    zonaLines = result.data.lines || [];
                    zonaSize  = { width: sc.width, height: sc.height };
                }
            }

            // Si logramos leer algo en la Zona Completa, afinamos dinámicamente
            // las ROIs y actualizamos los cuadros visibles para el siguiente escaneo.
            if (zonaLines && zonaSize) {
                refineRoisFromZonaCompleta(zonaLines, zonaSize, ZONA_COMPLETA_ROI.css);
                applyGuideStylesFromRois();
            }

            displayResults(combinedText);

        } catch (err) {
            console.error('OCR Error:', err);
            ocrDetails.innerHTML = '<div style="color:#f87171;">Error al procesar. Reintenta.</div>';
            scanResult.style.display = 'block';
        } finally {
            fullscreen.classList.remove('scanning');
            scanBtn.disabled = false;
            scanBtn.innerHTML = '<i class="fas fa-magnifying-glass"></i> Escanear Billete';
        }
    });

    // ── Utilidades de ROI ───────────────────────────────────────────────────

    /**
     * Calcula el área real del video dentro del canvas con object-fit: cover.
     * Con cover el video siempre llena el contenedor sin barras — toda la imagen
     * visible corresponde a píxeles del canvas, pero con posible recorte en bordes.
     */
    function getVideoBounds(videoEl, canvasEl) {
        const cW = canvasEl.width;
        const cH = canvasEl.height;
        const vW = videoEl.videoWidth;
        const vH = videoEl.videoHeight;

        const containerRatio = cW / cH;
        const videoRatio     = vW / vH;

        let drawW, drawH, offsetX, offsetY;

        if (videoRatio > containerRatio) {
            drawH   = cH;
            drawW   = cH * videoRatio;
            offsetX = (cW - drawW) / 2;
            offsetY = 0;
        } else {
            drawW   = cW;
            drawH   = cW / videoRatio;
            offsetX = 0;
            offsetY = (cH - drawH) / 2;
        }

        return { x: offsetX, y: offsetY, w: drawW, h: drawH };
    }

    /**
     * Convierte porcentajes CSS del .bill-guide a píxeles del canvas.
     * El .bill-guide es 92% ancho × aspect-ratio 2:1 del fullscreen (ver style.css).
     */
    function cssBoxToCanvasROI(vb, cssBox) {
        // En style.css .bill-guide tiene width: 92% y aspect-ratio: 2/1
        const guideW = vb.w * 0.92;
        const guideH = guideW / 2;  // Ratio 2:1
        const guideX = vb.x + (vb.w - guideW) / 2;
        const guideY = vb.y + (vb.h - guideH) / 2;

        const roiW = guideW * cssBox.width;
        const roiH = guideH * cssBox.height;

        const roiX = cssBox.left !== undefined
            ? guideX + guideW * cssBox.left
            : guideX + guideW * (1 - cssBox.right) - roiW;

        const roiY = cssBox.top !== undefined
            ? guideY + guideH * cssBox.top
            : guideY + guideH * (1 - cssBox.bottom) - roiH;

        return { x: roiX, y: roiY, w: roiW, h: roiH };
    }

    /**
     * A partir del OCR de la "Zona Completa" intenta localizar:
     * - La línea con la denominación (10/20/50/100/200)
     * - La línea con el número de serie
     * y ajusta ligeramente las ROIs correspondientes para futuros escaneos.
     */
    function refineRoisFromZonaCompleta(lines, zonaSize, zonaCss) {
        const { width: zonaW, height: zonaH } = zonaSize || {};
        if (!zonaW || !zonaH || !Array.isArray(lines) || !lines.length) return;

        let bestDenomLine = null;
        let bestSerialLine = null;

        const denomSet = new Set(['10', '20', '50', '100', '200']);
        const serialRegex = /[A-Z]?\d{7,9}\s*[A-Z]?/;

        for (const line of lines) {
            const raw = (line.text || '').toUpperCase().replace(/\s+/g, '');
            if (!raw) continue;

            if (!bestDenomLine) {
                const nums = raw.match(/\d{2,3}/g) || [];
                const match = nums.find(n => denomSet.has(n));
                if (match) bestDenomLine = line;
            }

            if (!bestSerialLine && serialRegex.test(raw)) {
                bestSerialLine = line;
            }
        }

        // Ayudantes
        const clamp01 = v => Math.max(0, Math.min(1, v));

        // Ajustar ROI de valor superior si encontramos una denominación
        if (bestDenomLine && bestDenomLine.bbox) {
            const b = bestDenomLine.bbox; // { x0, y0, x1, y1 } dentro de la Zona Completa
            const relX = b.x0 / zonaW;
            const relY = b.y0 / zonaH;
            const relW = (b.x1 - b.x0) / zonaW;
            const relH = (b.y1 - b.y0) / zonaH;

            const cx = zonaCss.left + zonaCss.width * (relX + relW / 2);
            const cy = zonaCss.top  + zonaCss.height * (relY + relH / 2);

            const roi = ROI_CONFIG.find(r => r.id === 'value-top');
            if (roi) {
                const w = clamp01(zonaCss.width  * relW * 1.8);
                const h = clamp01(zonaCss.height * relH * 2.0);
                const left = clamp01(cx - w / 2);
                const top  = clamp01(cy - h / 2);

                roi.css.top = top;
                roi.css.left = left;
                roi.css.width = w;
                roi.css.height = h;
            }

            // Reusar la misma X y ancho aproximados para el valor inferior
            const roiBottom = ROI_CONFIG.find(r => r.id === 'value-bottom');
            if (roiBottom) {
                roiBottom.css.left = ROI_CONFIG.find(r => r.id === 'value-top').css.left;
                roiBottom.css.width = ROI_CONFIG.find(r => r.id === 'value-top').css.width;
            }
        }

        // Ajustar ROI de serie superior si encontramos la serie
        if (bestSerialLine && bestSerialLine.bbox) {
            const b = bestSerialLine.bbox;
            const relX = b.x0 / zonaW;
            const relY = b.y0 / zonaH;
            const relW = (b.x1 - b.x0) / zonaW;
            const relH = (b.y1 - b.y0) / zonaH;

            const cx = zonaCss.left + zonaCss.width * (relX + relW / 2);
            const cy = zonaCss.top  + zonaCss.height * (relY + relH / 2);

            const roi = ROI_CONFIG.find(r => r.id === 'serial-top');
            if (roi) {
                const w = clamp01(zonaCss.width  * relW * 1.4);
                const h = clamp01(zonaCss.height * relH * 1.8);
                const left = clamp01(cx - w / 2);
                const top  = clamp01(cy - h / 2);

                roi.css.top = top;
                roi.css.left = left;
                roi.css.width = w;
                roi.css.height = h;
                // Quitamos `right` si existiera, para evitar conflictos
                delete roi.css.right;
            }

            const roiBottom = ROI_CONFIG.find(r => r.id === 'serial-bottom');
            if (roiBottom) {
                roiBottom.css.left = ROI_CONFIG.find(r => r.id === 'serial-top').css.left;
                roiBottom.css.width = ROI_CONFIG.find(r => r.id === 'serial-top').css.width;
            }
        }
    }

    /**
     * Aplica ROI_CONFIG a los cuadros visibles, para que la UI refleje exactamente
     * las mismas zonas que se usan para el recorte OCR.
     */
    function applyGuideStylesFromRois() {
        ROI_CONFIG.forEach(roi => {
            const el = document.querySelector(roi.selector);
            if (!el) return;

            const css = roi.css;

            if (css.top !== undefined) el.style.top = `${css.top * 100}%`;
            if (css.bottom !== undefined) el.style.bottom = `${css.bottom * 100}%`;
            if (css.left !== undefined) el.style.left = `${css.left * 100}%`;
            if (css.right !== undefined) el.style.right = `${css.right * 100}%`;
            if (css.width !== undefined) el.style.width = `${css.width * 100}%`;
            if (css.height !== undefined) el.style.height = `${css.height * 100}%`;
        });

        // Debug visual en consola: posiciones y tamaños actuales de todos los ROIs
        const debugData = ROI_CONFIG
            .filter(r => r.kind === 'valor' || r.kind === 'serie')
            .map(r => {
                const c = r.css;
                return {
                    id: r.id,
                    tipo: r.kind,
                    top:    c.top    !== undefined ? `${(c.top    * 100).toFixed(1)}%` : undefined,
                    bottom: c.bottom !== undefined ? `${(c.bottom * 100).toFixed(1)}%` : undefined,
                    left:   c.left   !== undefined ? `${(c.left   * 100).toFixed(1)}%` : undefined,
                    right:  c.right  !== undefined ? `${(c.right  * 100).toFixed(1)}%` : undefined,
                    width:  c.width  !== undefined ? `${(c.width  * 100).toFixed(1)}%` : undefined,
                    height: c.height !== undefined ? `${(c.height * 100).toFixed(1)}%` : undefined,
                };
            });
        // Esto se verá cada vez que se recalculan las guías (al cargar y tras cada escaneo)
        console.table(debugData);
    }

    // ── Mostrar resultados ──────────────────────────────────────────────────
    function displayResults(rawText) {
        const clean = rawText.toUpperCase().replace(/\s+/g, ' ');

        // --- Detección de denominación (más tolerante) ----------------------
        const denomCandidates = clean.match(/\d{2,3}/g) || [];
        const validDenomsSet = new Set(['10', '20', '50', '100', '200']);
        const denoms = [...new Set(denomCandidates.filter(d => validDenomsSet.has(d)))];

        // --- Detección de serie (más tolerante) -----------------------------
        const serialCandidates = clean.match(/[A-Z]?\d{7,9}\s*[A-Z]?/g) || [];
        const serials = [...new Set(
            serialCandidates
                .map(s => s.trim())
                .filter(s => {
                    const digits = (s.match(/\d/g) || []).length;
                    const letters = (s.match(/[A-Z]/g) || []).length;
                    return digits >= 7 && letters >= 1;
                })
        )];

        if (denoms.length > 0 || serials.length > 0) {
            // Si detectamos algo, cerramos escáner y abrimos el diálogo manual prellenado
            const prefill = {
                valor: denoms[0] || '',
                serie: serials[0] || ''
            };
            
            // Cerramos el scanner antes de mostrar el diálogo
            closeScanner();
            
            // Abrimos el diálogo de confirmación/edición manual
            openManualDialog(prefill);
            
            console.log('Redirigiendo a ingreso manual con datos detectados:', prefill);
        } else {
            // Si no detectamos nada útil, mostramos el panel de error en el scanner
            ocrDetails.innerHTML = `
                <div class="ocr-item">
                    <span style="color:#f87171">⚠ No se detectaron datos claros.</span>
                </div>
                <div style="font-size:0.7rem; color:var(--text-muted); margin-top:0.5rem;">
                    Asegúrate de que el billete esté bien iluminado y dentro de los recuadros.
                </div>
            `;
            scanResult.style.display = 'block';
        }
    }
});

