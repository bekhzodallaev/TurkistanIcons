import { Resvg } from '@resvg/resvg-js';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

export interface RenderedPreviews {
  png: Buffer;
  thumb: Buffer;
}

const PREVIEW_WIDTH = 512;
const THUMB_SIZE = 128;

/**
 * Renders PNG previews from the **sanitized** SVG only (never the raw upload).
 * resvg rasterizes with system-font loading disabled and no network access;
 * sharp normalizes/compresses and produces the thumbnail. See
 * docs/UPLOAD-PIPELINE.md §5.
 */
@Injectable()
export class PreviewRendererService {
  async render(svg: Buffer): Promise<RenderedPreviews> {
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: PREVIEW_WIDTH },
      // No remote/system font fetch — deterministic and safe.
      font: { loadSystemFonts: false },
      background: 'rgba(0,0,0,0)',
    });
    const rasterized = resvg.render().asPng();

    const [png, thumb] = await Promise.all([
      sharp(rasterized).png({ compressionLevel: 9 }).toBuffer(),
      sharp(rasterized)
        .resize(THUMB_SIZE, THUMB_SIZE, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ]);

    return { png, thumb };
  }
}
