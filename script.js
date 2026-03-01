import Tesseract from 'tesseract.js';

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

    let stream = null;

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
        scanBtn.textContent = '🔍 Escanear Billete';
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
        scanBtn.textContent = 'Procesando...';
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

            // ROIs — deben coincidir con los porcentajes en style.css (.bill-guide)
            // Ajustados para el billete de Bs20 según la imagen de referencia.
            const rois = [
                { name: 'Valor Superior',              css: { top: 0.11, left: 0.04, width: 0.12, height: 0.26 }, kind: 'valor' },
                { name: 'Valor Inferior',              css: { bottom: 0.10, left: 0.04, width: 0.12, height: 0.20 }, kind: 'valor' },
                { name: 'Serie Superior (horizontal)', css: { top: 0.10, right: 0.07, width: 0.27, height: 0.11 },   kind: 'serie' },
                { name: 'Serie Inferior (horizontal)', css: { bottom: 0.12, left: 0.16, width: 0.38, height: 0.15 }, kind: 'serie' },
                // Fallback amplio: casi todo el billete, por si el usuario no lo alinea perfecto
                { name: 'Zona Completa',               css: { top: 0.04, left: 0.02, width: 0.96, height: 0.92 },   kind: 'mixto' },
            ];

            let combinedText = '';

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
            }

            displayResults(combinedText);

        } catch (err) {
            console.error('OCR Error:', err);
            ocrDetails.innerHTML = '<div style="color:#f87171;">Error al procesar. Reintenta.</div>';
            scanResult.style.display = 'block';
        } finally {
            fullscreen.classList.remove('scanning');
            scanBtn.disabled = false;
            scanBtn.textContent = '🔍 Escanear Billete';
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

    // ── Mostrar resultados ──────────────────────────────────────────────────
    function displayResults(rawText) {
        const clean = rawText.toUpperCase().replace(/\s+/g, ' ');

        // --- Detección de denominación (más tolerante) ----------------------
        const denomCandidates = clean.match(/\d{2,3}/g) || [];
        const validDenomsSet = new Set(['10', '20', '50', '100', '200']);
        const denoms = [...new Set(denomCandidates.filter(d => validDenomsSet.has(d)))];

        // --- Detección de serie (más tolerante) -----------------------------
        // Acepta variantes como: A181733528, 181733528A, 181733528 A, etc.
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

        let html = '';

        if (!denoms.length && !serials.length && rawText.trim().length < 5) {
            html = '<div class="ocr-item">No se detectaron datos. Centra el billete y vuelve a intentar.</div>';
        } else {
            const valor  = denoms.length  ? `Bs. ${denoms.join(' / ')}` : 'No detectado';
            const serie  = serials.length ? serials.join(' / ')          : 'No detectado';
            const estado = (denoms.length && serials.length)
                ? '<span style="color:#4ade80">✓ Análisis Positivo</span>'
                : '<span style="color:#f87171">⚠ Datos Incompletos</span>';

            html += `<div class="ocr-item"><span class="ocr-label">Denominación:</span><span class="accent-text">${valor}</span></div>`;
            html += `<div class="ocr-item"><span class="ocr-label">Nro de Serie:</span><span>${serie}</span></div>`;
            html += `<div class="ocr-item"><span class="ocr-label">Estado:</span>${estado}</div>`;
            html += `<div style="margin-top:0.75rem;font-size:0.72rem;color:var(--text-muted);border-top:1px dashed #444;padding-top:0.5rem;max-height:80px;overflow:auto;">
                <strong>TEXTO DETECTADO:</strong><br>${rawText.replace(/\n/g, '<br>')}
            </div>`;
        }

        ocrDetails.innerHTML = html;
        scanResult.style.display = 'block';
    }
});

