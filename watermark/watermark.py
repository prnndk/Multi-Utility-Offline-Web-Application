#!/usr/bin/env python3
"""
Privacy-First Image Watermark - Standalone Python Script
A local CLI tool for adding watermarks to images.

Usage:
    python watermark.py <image.jpg> --text "© Your Name"
    python watermark.py <image.jpg> --text "© 2024" --opacity 0.5 --position bottom-right
    python watermark.py <image.jpg> --text "CONFIDENTIAL" --tile

Requirements:
    pip install Pillow pillow-heif
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Error: Pillow library not found.")
    print("Install it with: pip install Pillow")
    sys.exit(1)

# Optional HEIC support
HEIC_SUPPORT = False
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIC_SUPPORT = True
except ImportError:
    pass


def get_font(size: int):
    """Try to load a nice font, fall back to default if not available."""
    font_names = [
        "Arial Bold", "arial", "DejaVuSans-Bold", "DejaVuSans",
        "Helvetica", "FreeSansBold", "LiberationSans-Bold"
    ]
    
    for font_name in font_names:
        try:
            return ImageFont.truetype(font_name, size)
        except (OSError, IOError):
            continue
    
    # Fall back to default font
    try:
        return ImageFont.load_default()
    except:
        return None


def get_position_coords(position: str, img_width: int, img_height: int, 
                        text_width: int, text_height: int, padding: int = 20):
    """Calculate x, y coordinates based on position name."""
    positions = {
        'top-left': (padding, padding),
        'top-center': ((img_width - text_width) // 2, padding),
        'top-right': (img_width - text_width - padding, padding),
        'middle-left': (padding, (img_height - text_height) // 2),
        'center': ((img_width - text_width) // 2, (img_height - text_height) // 2),
        'middle-right': (img_width - text_width - padding, (img_height - text_height) // 2),
        'bottom-left': (padding, img_height - text_height - padding),
        'bottom-center': ((img_width - text_width) // 2, img_height - text_height - padding),
        'bottom-right': (img_width - text_width - padding, img_height - text_height - padding)
    }
    return positions.get(position, positions['center'])


def add_watermark(image: Image.Image, text: str, font_size: int = 48, 
                  opacity: float = 0.5, color: str = "#FFFFFF",
                  position: str = "center", tile: bool = False,
                  rotation: int = -30) -> Image.Image:
    """Add watermark text to an image."""
    
    # Convert image to RGBA for transparency support
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    
    # Create a transparent overlay
    overlay = Image.new('RGBA', image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Get font
    font = get_font(font_size)
    
    # Parse color
    if color.startswith('#'):
        color = color[1:]
    r, g, b = int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16)
    alpha = int(255 * opacity)
    
    # Get text size
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    if tile:
        # Create a larger canvas for rotation
        diagonal = int((image.width ** 2 + image.height ** 2) ** 0.5)
        tile_overlay = Image.new('RGBA', (diagonal * 2, diagonal * 2), (0, 0, 0, 0))
        tile_draw = ImageDraw.Draw(tile_overlay)
        
        spacing_x = int(text_width * 1.5)
        spacing_y = int(font_size * 2)
        
        for y in range(0, diagonal * 2, spacing_y):
            for x in range(0, diagonal * 2, spacing_x):
                tile_draw.text((x, y), text, font=font, fill=(r, g, b, alpha))
        
        # Rotate and crop
        tile_overlay = tile_overlay.rotate(rotation, expand=False, center=(diagonal, diagonal))
        
        # Center crop to original size
        left = (tile_overlay.width - image.width) // 2
        top = (tile_overlay.height - image.height) // 2
        tile_overlay = tile_overlay.crop((left, top, left + image.width, top + image.height))
        
        overlay = tile_overlay
    else:
        # Single watermark
        x, y = get_position_coords(position, image.width, image.height, 
                                   text_width, text_height)
        
        # Draw shadow
        shadow_offset = max(2, font_size // 24)
        draw.text((x + shadow_offset, y + shadow_offset), text, font=font, 
                  fill=(0, 0, 0, alpha // 2))
        
        # Draw text
        draw.text((x, y), text, font=font, fill=(r, g, b, alpha))
    
    # Composite the overlay onto the image
    result = Image.alpha_composite(image, overlay)
    
    return result


def process_image(input_path: str, output_path: str = None, **kwargs) -> str:
    """Process a single image file."""
    
    input_file = Path(input_path)
    
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    
    # Generate output path if not provided
    if output_path is None:
        output_path = input_file.parent / f"{input_file.stem}_watermarked{input_file.suffix}"
    else:
        output_path = Path(output_path)
    
    # Open image
    print(f"\n🖼️  Opening: {input_file.name}")
    image = Image.open(input_path)
    print(f"   Size: {image.width} x {image.height}")
    
    # Add watermark
    print(f"📝 Adding watermark: \"{kwargs.get('text', '© 2024')}\"")
    result = add_watermark(image, **kwargs)
    
    # Save result
    print(f"💾 Saving: {output_path.name}")
    
    # Convert to RGB if saving as JPEG
    if output_path.suffix.lower() in ['.jpg', '.jpeg']:
        result = result.convert('RGB')
    
    result.save(str(output_path), quality=95)
    
    return str(output_path)


def main():
    parser = argparse.ArgumentParser(
        description='Privacy-First Image Watermark - Add watermarks to images locally',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python watermark.py photo.jpg --text "© John Doe"
  python watermark.py photo.png --text "DRAFT" --opacity 0.3 --color "#FF0000"
  python watermark.py photo.jpg --text "CONFIDENTIAL" --tile --rotation -45
  python watermark.py photo.jpg --text "© 2024" --position bottom-right --font-size 24
        '''
    )
    
    parser.add_argument('input', help='Path to the image file')
    parser.add_argument('--text', '-t', default='© 2024', help='Watermark text (default: © 2024)')
    parser.add_argument('--font-size', '-s', type=int, default=48, help='Font size in pixels (default: 48)')
    parser.add_argument('--opacity', '-a', type=float, default=0.5, help='Opacity 0.0-1.0 (default: 0.5)')
    parser.add_argument('--color', '-c', default='#FFFFFF', help='Text color in hex (default: #FFFFFF)')
    parser.add_argument('--position', '-p', default='center',
                        choices=['top-left', 'top-center', 'top-right',
                                'middle-left', 'center', 'middle-right',
                                'bottom-left', 'bottom-center', 'bottom-right'],
                        help='Watermark position (default: center)')
    parser.add_argument('--tile', action='store_true', help='Tile watermark across entire image')
    parser.add_argument('--rotation', '-r', type=int, default=-30, help='Rotation angle in degrees (default: -30)')
    parser.add_argument('--output', '-o', help='Output file path (default: <input>_watermarked.<ext>)')
    
    args = parser.parse_args()
    
    print("\n" + "=" * 50)
    print("   🔒 Privacy-First Image Watermark")
    print("   All processing happens locally on your machine")
    print("=" * 50)
    
    try:
        output_path = process_image(
            args.input,
            args.output,
            text=args.text,
            font_size=args.font_size,
            opacity=args.opacity,
            color=args.color,
            position=args.position,
            tile=args.tile,
            rotation=args.rotation
        )
        
        print("\n" + "=" * 50)
        print("   ✅ Watermark Applied Successfully!")
        print("=" * 50)
        print(f"\n   📁 Output: {output_path}\n")
        
    except FileNotFoundError as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ An unexpected error occurred: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
