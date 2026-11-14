import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * Affiche un document HTML A4 produit par le serveur (aperçu ou CV final)
 * dans une iframe isolée, mise à l'échelle de la colonne.
 *
 * - `sandbox` sans `allow-scripts` : aucun script du document ne s'exécute ;
 *   `allow-same-origin` sert seulement à mesurer la hauteur et à imprimer.
 * - Le HTML est affiché tel quel : aucune partie n'est masquée ici, l'aperçu
 *   arrive déjà caviardé du serveur (invariant n° 6).
 */

const A4_WIDTH_PX = 794; // 210 mm à 96 dpi
const A4_HEIGHT_PX = 1123;

/** Retire la marge « écran » du document pour l'intégrer dans la page. */
const EMBED_STYLE =
  "<style>html,body{background:#fff!important}.page{margin:0!important;box-shadow:none!important}</style>";

export interface CvFrameHandle {
  print: () => boolean;
}

interface CvFrameProps {
  html: string;
  title: string;
  /** Hauteur max affichée (en px écran) avant défilement interne. */
  maxHeight?: number;
}

export const CvFrame = forwardRef<CvFrameHandle, CvFrameProps>(function CvFrame(
  { html, title, maxHeight },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(1);
  const [docHeight, setDocHeight] = useState(A4_HEIGHT_PX);

  useImperativeHandle(ref, () => ({
    print: () => {
      const win = frameRef.current?.contentWindow;
      if (!win) return false;
      win.focus();
      win.print();
      return true;
    },
  }));

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const update = () => setScale(Math.min(1, wrap.clientWidth / A4_WIDTH_PX));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    setDocHeight(Math.max(A4_HEIGHT_PX, doc.documentElement.scrollHeight));
  }, []);

  const srcDoc = html.includes("</head>") ? html.replace("</head>", `${EMBED_STYLE}</head>`) : html;
  const visibleHeight = docHeight * scale;

  return (
    <div
      ref={wrapRef}
      className="cv-frame"
      style={{
        height: maxHeight ? Math.min(visibleHeight, maxHeight) : visibleHeight,
        overflowY: maxHeight && visibleHeight > maxHeight ? "auto" : "hidden",
      }}
    >
      <div style={{ width: A4_WIDTH_PX * scale, height: visibleHeight }}>
        <iframe
          ref={frameRef}
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-same-origin allow-modals"
          onLoad={measure}
          style={{
            width: A4_WIDTH_PX,
            height: docHeight,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
    </div>
  );
});
