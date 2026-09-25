import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seed Divine Closet...");

  const adminPassword = await bcrypt.hash("admin123", 10);
  const clientPassword = await bcrypt.hash("cliente123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@divinecloset.com" },
    update: { role: "ADMIN" },
    create: {
      email: "admin@divinecloset.com",
      name: "Admin Divine",
      password: adminPassword,
      role: "ADMIN",
      phone: "11999990000",
    },
  });

  const client = await prisma.user.upsert({
    where: { email: "cliente@divinecloset.com" },
    update: {},
    create: {
      email: "cliente@divinecloset.com",
      name: "Maria Cliente",
      password: clientPassword,
      role: "CLIENT",
      phone: "11988887777",
    },
  });

  const categoriesData = [
    { name: "Vestidos", slug: "vestidos", description: "Vestidos para todos os momentos" },
    { name: "Conjuntos", slug: "conjuntos", description: "Conjuntos coordendos" },
    { name: "Blusas", slug: "blusas", description: "Blusas e crop tops" },
    { name: "Calças", slug: "calcas", description: "Calças e shorts" },
    { name: "Acessórios", slug: "acessorios", description: "Bolsas, bijuterias e mais" },
    { name: "Sapatos", slug: "sapatos", description: "Calçados especiais" },
  ];

  const categories: Record<string, { id: string }> = {};
  for (const c of categoriesData) {
    categories[c.slug] = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }

  const productsData = [
    {
      name: "Vestido Midi Celestial",
      slug: "vestido-midi-celestial",
      description:
        "Vestido midi em tecido fluído com estampa celestial delicada. Cintura marcada, alças ajustáveis e forro interno.\n\n• Tecido: viscose premium\n• Comprimento midi\n• Indo para festas e jantares especiais",
      price: 289.9,
      comparePrice: 359.9,
      stock: 24,
      featured: true,
      images: ["/uploads/vestido-celestial.jpg"],
      sizes: ["PP", "P", "M", "G", "GG"],
      colors: ["Azul noite", "Champanhe"],
      category: "vestidos",
      sku: "DC-VES-001",
    },
    {
      name: "Vestido Longo Aurora",
      slug: "vestido-longo-aurora",
      description:
        "Vestido longo com transição de cores em degradê aurora. Fenda lateral discreta e decote v.\n\n• Tecido: cetalinho\n• Comprimento longo\n• Ideal para eventos",
      price: 449.9,
      comparePrice: 549.9,
      stock: 12,
      featured: true,
      images: ["/uploads/vestido-aurora.jpg"],
      sizes: ["P", "M", "G"],
      colors: ["Dourado", "Rosé"],
      category: "vestidos",
      sku: "DC-VES-002",
    },
    {
      name: "Conjunto Linho Essenza",
      slug: "conjunto-linho-essenza",
      description:
        "Conjunto de blusa e calça em linho misto. Peça respirável e elegante para o dia a dia sofisticado.\n\n• Tecido: linho misto\n• Duas peças\n• Bolso lateral na calça",
      price: 319.9,
      stock: 30,
      featured: true,
      images: ["/uploads/conjunto-essenza.jpg"],
      sizes: ["P", "M", "G", "GG"],
      colors: ["Areia", "Verde salva", "Branco"],
      category: "conjuntos",
      sku: "DC-CNJ-001",
    },
    {
      name: "Conjunto Street Luxe",
      slug: "conjunto-street-luxe",
      description:
        "Conjunto cropped + bermuda wide leg com detalhes em fita dourada. Mistura o casual com o luxo.\n\n• Tecido: sarja\n• Duas peças\n• Cintura com elástico",
      price: 259.9,
      comparePrice: 299.9,
      stock: 18,
      featured: false,
      images: ["/uploads/conjunto-street.jpg"],
      sizes: ["PP", "P", "M", "G"],
      colors: ["Preto", "Off white"],
      category: "conjuntos",
      sku: "DC-CNJ-002",
    },
    {
      name: "Blusa Cropped Seda Divina",
      slug: "blusa-cropped-seda-divina",
      description:
        "Crop top de seda sintética com gola rebatida e botões perolados. Toque suave e brilho sutil.\n\n• Tecido: cetim\n• Botões perolados",
      price: 149.9,
      stock: 40,
      featured: true,
      images: ["/uploads/blusa-seda.jpg"],
      sizes: ["PP", "P", "M", "G"],
      colors: ["Champagne", "Preto", "Vinho"],
      category: "blusas",
      sku: "DC-BLU-001",
    },
    {
      name: "Camisa Oversized Power",
      slug: "camisa-oversized-power",
      description:
        "Camisa oversized de algodão egípcio com caimento estruturado. Perfeita para o look power casual.\n\n• Tecido: algodão egípcio\n• Fit oversized",
      price: 199.9,
      stock: 22,
      featured: false,
      images: ["/uploads/camisa-power.jpg"],
      sizes: ["P", "M", "G", "GG"],
      colors: ["Branco", "Azul céu"],
      category: "blusas",
      sku: "DC-BLU-002",
    },
    {
      name: "Calça Wide Leg Celeste",
      slug: "calca-wide-leg-celeste",
      description:
        "Calça wide leg de alfaiataria com pregões frontais e cós alto. Alonga a silhueta.\n\n• Tecido: crepe de alfaiataria\n• Cós alto",
      price: 279.9,
      comparePrice: 329.9,
      stock: 16,
      featured: false,
      images: ["/uploads/calca-celeste.jpg"],
      sizes: ["34", "36", "38", "40", "42"],
      colors: ["Preto", "Caramelo"],
      category: "calcas",
      sku: "DC-CAL-001",
    },
    {
      name: "Short High Waist Solar",
      slug: "short-high-waist-solar",
      description:
        "Short de cintura alta em sarja elástica. Conforto e estilo para o verão.\n\n• Tecido: sarja com elastano\n• Cintura alta",
      price: 129.9,
      stock: 35,
      featured: false,
      images: ["/uploads/short-solar.jpg"],
      sizes: ["34", "36", "38", "40"],
      colors: ["Areia", "Verde militar"],
      category: "calcas",
      sku: "DC-CAL-002",
    },
    {
      name: "Bolsa Tote Divine Glow",
      slug: "bolsa-tote-divine-glow",
      description:
        "Bolsa tote em couro sintético com acabamento dourado e alças reforçadas. Espaçosa e sofisticada.\n\n• Couro sintético premium\n• Forro em cetim",
      price: 219.9,
      stock: 20,
      featured: true,
      images: ["/uploads/bolsa-glow.jpg"],
      sizes: ["Único"],
      colors: ["Preto", "Marrom", "Branco"],
      category: "acessorios",
      sku: "DC-ACE-001",
    },
    {
      name: "Colar Corrente Lumière",
      slug: "colar-corrente-lumiere",
      description:
        "Colar banhado a ouro 18k com elos alternados e pingente sutil. Hipoalergênico.\n\n• Banho de ouro 18k\n• Comprimento: 45cm",
      price: 89.9,
      comparePrice: 119.9,
      stock: 50,
      featured: false,
      images: ["/uploads/colar-lumiere.jpg"],
      sizes: ["Único"],
      colors: ["Dourado", "Prata"],
      category: "acessorios",
      sku: "DC-ACE-002",
    },
    {
      name: "Scarpin Clássico Aura",
      slug: "scarpin-classico-aura",
      description:
        "Scarpin de salto médio em nobuck com bico fino. O clássico que eleva qualquer look.\n\n• Salto 7cm\n• Palmilha acolchoada",
      price: 349.9,
      stock: 14,
      featured: false,
      images: ["/uploads/scarpin-aura.jpg"],
      sizes: ["34", "35", "36", "37", "38", "39"],
      colors: ["Nude", "Preto", "Vermelho"],
      category: "sapatos",
      sku: "DC-SAP-001",
    },
    {
      name: "Tênis Chunky Prisma",
      slug: "tenis-chunky-prisma",
      description:
        "Tênis chunky com solado tridimensional e detalhes metálicos. Conforto e atitude.\n\n• Solado emborrachado\n• Cadarço duplo",
      price: 399.9,
      comparePrice: 479.9,
      stock: 10,
      featured: false,
      images: ["/uploads/tenis-prisma.jpg"],
      sizes: ["34", "35", "36", "37", "38"],
      colors: ["Branco", "Preto"],
      category: "sapatos",
      sku: "DC-SAP-002",
    },
  ];

  for (const p of productsData) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        price: p.price,
        comparePrice: p.comparePrice ?? null,
        stock: p.stock,
        featured: p.featured,
        isActive: true,
      },
      create: {
        name: p.name,
        slug: p.slug,
        description: p.description,
        price: p.price,
        comparePrice: p.comparePrice ?? null,
        sku: p.sku,
        stock: p.stock,
        featured: p.featured,
        isActive: true,
        images: p.images,
        sizes: p.sizes,
        colors: p.colors,
        categoryId: categories[p.category].id,
      },
    });
  }

  const couponsData = [
    {
      code: "BEMVINDO10",
      type: "PERCENT" as const,
      value: 10,
      minSubtotal: 100,
      maxUses: null as number | null,
      endsAt: null as Date | null,
    },
    {
      code: "FRETEGRATIS",
      type: "FREE_SHIPPING" as const,
      value: 0,
      minSubtotal: 150,
      maxUses: null as number | null,
      endsAt: null as Date | null,
    },
    {
      code: "DIVINE30",
      type: "FIXED" as const,
      value: 30,
      minSubtotal: 250,
      maxUses: 100,
      endsAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  ];

  for (const c of couponsData) {
    await prisma.coupon.upsert({
      where: { code: c.code },
      update: {
        type: c.type,
        value: c.value,
        minSubtotal: c.minSubtotal,
        maxUses: c.maxUses,
        endsAt: c.endsAt,
        active: true,
        deletedAt: null,
      },
      create: {
        code: c.code,
        type: c.type,
        value: c.value,
        minSubtotal: c.minSubtotal,
        maxUses: c.maxUses,
        endsAt: c.endsAt,
        active: true,
      },
    });
  }

  await prisma.banner.upsert({
    where: { id: "home-hero-1" },
    update: {},
    create: {
      id: "home-hero-1",
      title: "Nova coleção",
      subtitle: "Peças exclusivas para brilhar",
      imageUrl: "/uploads/banner-placeholder.jpg",
      linkUrl: "/produtos",
      position: 0,
      status: "ACTIVE",
    },
  });

  console.log("✅ Seed concluído!");
  console.log("   👤 Admin:   admin@divinecloset.com / admin123");
  console.log("   👤 Cliente: cliente@divinecloset.com / cliente123");
  console.log(
    `   👗 Produtos: ${productsData.length} | Categorias: ${categoriesData.length} | Cupons: ${couponsData.length}`
  );
  console.log(`   🪪 IDs: admin=${admin.id} client=${client.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
