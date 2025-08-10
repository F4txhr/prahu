#!/usr/bin/env python3
"""
Demo script untuk showcase 3 metode input VPN links:
1. Manual paste - Input manual link VPN
2. API URL - Fetch dari API endpoint  
3. Raw URL - Fetch dari raw text URL
"""

import sys
sys.path.append('.')
from main import get_user_vpn_links

def demo_input_methods():
    print("🚀 VPN TOOLS - Multi-Method Input Demo")
    print("=" * 50)
    
    # Call function dengan 3 pilihan
    links = get_user_vpn_links()
    
    print("\n" + "=" * 50)
    print("📊 HASIL INPUT:")
    print("=" * 50)
    
    if links:
        print(f"✅ Total VPN links ditemukan: {len(links)}")
        print("\n📋 Preview links:")
        for i, link in enumerate(links[:5], 1):
            # Show protocol dan first part
            protocol = link.split('://')[0] if '://' in link else 'unknown'
            preview = link[:40] + "..." if len(link) > 40 else link
            print(f"  {i}. [{protocol.upper()}] {preview}")
        
        if len(links) > 5:
            print(f"  ... dan {len(links) - 5} links lainnya")
            
        print(f"\n🎯 Siap untuk testing dan config generation!")
        
    else:
        print("❌ Tidak ada VPN links ditemukan")
        
    print("\n" + "=" * 50)

if __name__ == "__main__":
    demo_input_methods()