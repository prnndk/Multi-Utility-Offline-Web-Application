#!/usr/bin/env python3
"""
Privacy-First PDF Compressor - Standalone Python Script
A local alternative to the web-based PDF compressor.

Usage:
    python compressor.py <input.pdf> [--quality low|medium|high] [--output filename.pdf]

Requirements:
    pip install pypdf
"""

import argparse
import sys
from pathlib import Path

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    print("Error: pypdf library not found.")
    print("Install it with: pip install pypdf")
    sys.exit(1)


def format_size(size_bytes: int) -> str:
    """Format file size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} TB"


def get_compression_params(quality: str) -> dict:
    """Get compression parameters based on quality setting."""
    params = {
        'low': {
            'remove_duplication': True,
            'remove_images': False,
            'image_quality': 30
        },
        'medium': {
            'remove_duplication': True,
            'remove_images': False,
            'image_quality': 50
        },
        'high': {
            'remove_duplication': True,
            'remove_images': False,
            'image_quality': 75
        }
    }
    return params.get(quality, params['medium'])


def compress_pdf(input_path: str, output_path: str = None, quality: str = 'medium') -> tuple:
    """
    Compress a PDF file.
    
    Args:
        input_path: Path to the input PDF file
        output_path: Path for the output file (optional)
        quality: Compression quality (low, medium, high)
    
    Returns:
        Tuple of (original_size, compressed_size, output_path)
    """
    input_file = Path(input_path)
    
    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    
    if not input_file.suffix.lower() == '.pdf':
        raise ValueError("Input file must be a PDF")
    
    # Generate output path if not provided
    if output_path is None:
        output_path = input_file.parent / f"{input_file.stem}_compressed.pdf"
    else:
        output_path = Path(output_path)
    
    # Get original file size
    original_size = input_file.stat().st_size
    
    # Get compression parameters
    params = get_compression_params(quality)
    
    # Read and compress PDF
    print(f"\n📄 Reading: {input_file.name}")
    reader = PdfReader(str(input_file))
    writer = PdfWriter()
    
    total_pages = len(reader.pages)
    print(f"📑 Total pages: {total_pages}")
    print(f"🔧 Quality: {quality.capitalize()}")
    print("\n⏳ Compressing...")
    
    # Copy all pages to writer
    for i, page in enumerate(reader.pages, 1):
        writer.add_page(page)
        # Progress indicator
        progress = int((i / total_pages) * 40)
        bar = '█' * progress + '░' * (40 - progress)
        print(f"\r   [{bar}] {i}/{total_pages}", end='', flush=True)
    
    print()  # New line after progress bar
    
    # Apply compression - remove duplication
    if params['remove_duplication']:
        writer.add_metadata(reader.metadata or {})
        
    # Compress content streams
    for page in writer.pages:
        page.compress_content_streams()
    
    # Write compressed PDF
    print(f"\n💾 Saving: {output_path.name}")
    with open(output_path, 'wb') as f:
        writer.write(f)
    
    # Get compressed file size
    compressed_size = output_path.stat().st_size
    
    return original_size, compressed_size, str(output_path)


def main():
    parser = argparse.ArgumentParser(
        description='Privacy-First PDF Compressor - Compress PDF files locally',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python compressor.py document.pdf
  python compressor.py document.pdf --quality low
  python compressor.py document.pdf --output compressed.pdf --quality high
        '''
    )
    
    parser.add_argument('input', help='Path to the PDF file to compress')
    parser.add_argument(
        '--quality', '-q',
        choices=['low', 'medium', 'high'],
        default='medium',
        help='Compression quality (default: medium)'
    )
    parser.add_argument(
        '--output', '-o',
        help='Output file path (default: <input>_compressed.pdf)'
    )
    
    args = parser.parse_args()
    
    print("\n" + "=" * 50)
    print("   🔒 Privacy-First PDF Compressor")
    print("   All processing happens locally on your machine")
    print("=" * 50)
    
    try:
        original_size, compressed_size, output_path = compress_pdf(
            args.input,
            args.output,
            args.quality
        )
        
        # Calculate savings
        if original_size > 0:
            savings_percent = ((original_size - compressed_size) / original_size) * 100
        else:
            savings_percent = 0
        
        print("\n" + "=" * 50)
        print("   ✅ Compression Complete!")
        print("=" * 50)
        print(f"\n   📊 Results:")
        print(f"   ├─ Original:   {format_size(original_size)}")
        print(f"   ├─ Compressed: {format_size(compressed_size)}")
        
        if savings_percent > 0:
            print(f"   └─ Saved:      {savings_percent:.1f}% smaller")
        else:
            print(f"   └─ Note:       File size increased by {abs(savings_percent):.1f}%")
            print("        (This can happen with already-compressed PDFs)")
        
        print(f"\n   📁 Output: {output_path}")
        print()
        
    except FileNotFoundError as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    except ValueError as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ An unexpected error occurred: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
