import { PreviewRendererService } from './preview-renderer.service';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#16a34a"/></svg>',
);

describe('PreviewRendererService', () => {
  const renderer = new PreviewRendererService();

  it('renders a PNG preview and thumbnail from a sanitized SVG', async () => {
    const { png, thumb } = await renderer.render(SVG);

    expect(png.byteLength).toBeGreaterThan(0);
    expect(thumb.byteLength).toBeGreaterThan(0);
    expect([...png.subarray(0, 4)]).toEqual(PNG_MAGIC);
    expect([...thumb.subarray(0, 4)]).toEqual(PNG_MAGIC);
    // The thumbnail compresses to fewer bytes than the 512px preview.
    expect(thumb.byteLength).toBeLessThan(png.byteLength);
  });
});
