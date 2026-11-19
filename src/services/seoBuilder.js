const DEFAULT_LOGO_PATH = '/assets/images/domino-01-46780d2ec1.webp';
const DEFAULT_OG_IMAGE_PATH = '/assets/images/domino-02-d89559715b.jpg';

function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function toAbsoluteUrl(urlOrPath, origin) {
  const s = String(urlOrPath || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}${s.startsWith('/') ? '' : '/'}${s}`;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FAQ_ITEMS = [
  {
    q: 'DOMINO là đơn vị nào?',
    a: 'DOMINO là thương hiệu thiết kế, sản xuất và thi công tủ bếp INOX cánh kính, hoạt động từ năm 2015, có showroom và xưởng sản xuất tại Thái Bình. DOMINO định vị là người đồng hành giúp gia chủ đưa ra quyết định đúng cho căn bếp sử dụng 10–20 năm.',
  },
  {
    q: 'Tủ bếp INOX cánh kính của DOMINO có gì khác biệt?',
    a: 'Kết cấu chính là khung và thùng INOX kết hợp cánh kính nhập khẩu. DOMINO chú trọng phần cấu tạo bên trong (khung, thùng và liên kết) cùng chính sách bảo hành rõ ràng theo từng cấu phần, thay vì chỉ tập trung vào bề mặt bên ngoài.',
  },
  {
    q: 'Cấu tạo thùng tủ gồm những phương án nào?',
    a: 'DOMINO có hai phương án thùng inox sơn hàn tĩnh điện, cùng hệ cánh kính với phần bo cánh bằng hợp kim nhôm và inox. Phương án phù hợp sẽ được tư vấn cụ thể theo thiết kế và ngân sách của từng gia đình.',
  },
  {
    q: 'Cánh kính sử dụng loại kính gì?',
    a: 'DOMINO sử dụng cánh kính nhập khẩu, là kính thường kết hợp lớp film an toàn ở mặt sau, với khung viền đen hoặc trắng và tay nắm CNC.',
  },
  {
    q: 'Các loại gỗ làm tủ bếp khác nhau thế nào khi dùng lâu trong bếp ẩm?',
    a: 'Gỗ công nghiệp (MDF, MFC, HDF) dễ ngấm hơi ẩm ở cạnh và mối nối gây phồng, bong cạnh; ván ép nhiều lớp có thể tách lớp khi keo lão hóa; gỗ tự nhiên dễ co giãn, cong vênh và cần xử lý mối mọt. Khung thùng INOX không hút ẩm và không bị mối mọt, giữ form ổn định lâu dài trong môi trường bếp nóng ẩm.',
  },
  {
    q: 'Phụ kiện tủ bếp dùng thương hiệu nào?',
    a: 'DOMINO sử dụng và tư vấn các thương hiệu phụ kiện uy tín như HIGOLD, Blum, Eurogold, GrandX, Konox, Bosch theo trải nghiệm đóng mở, lưu trữ và cấu hình từng thiết kế cụ thể.',
  },
  {
    q: 'Chi phí làm tủ bếp phụ thuộc vào những gì?',
    a: 'Chi phí phụ thuộc vào kích thước, cấu tạo thùng tủ, vật liệu cánh, phụ kiện, mặt đá và thiết bị, cùng các hạng mục hoàn thiện. Báo giá cụ thể được xác định sau khi khảo sát và lên thiết kế thực tế.',
  },
  {
    q: 'Tiến độ sản xuất và thi công mất bao lâu?',
    a: 'Tiến độ phụ thuộc vào quy mô, thiết kế và điều kiện thi công thực tế của từng công trình. Gia chủ liên hệ trực tiếp để DOMINO báo tiến độ chính xác.',
  },
  {
    q: 'Chính sách bảo hành như thế nào?',
    a: 'Bảo hành theo từng cấu phần: khung/thùng INOX bảo hành 20 năm cho dòng Basic đến Premium và trọn đời cho dòng VIP 1 đến VIP 3; cánh kính bảo hành 3 năm (Basic) và 5 năm (Signature).',
  },
  {
    q: 'DOMINO có khảo sát tại nhà không?',
    a: 'Có. Khảo sát và đo đạc không gian thực tế tại nhà là bước thứ hai trong quy trình 8 bước của DOMINO để làm cơ sở thiết kế và báo giá chính xác.',
  },
  {
    q: 'Quy trình làm tủ bếp gồm những bước nào?',
    a: 'Quy trình gồm 8 bước: (1) Tiếp nhận nhu cầu, (2) Khảo sát, (3) Tư vấn thiết kế, (4) Báo giá, (5) Sản xuất tại xưởng riêng, (6) Thi công lắp đặt, (7) Nghiệm thu bàn giao, (8) Bảo hành và hậu mãi.',
  },
];

const PROCESS_STEPS = [
  { name: 'Tiếp nhận nhu cầu', text: 'Trao đổi về không gian, thói quen nấu nướng và mong muốn của gia đình.' },
  { name: 'Khảo sát', text: 'Đo đạc và ghi nhận hiện trạng không gian thực tế tại nhà.' },
  { name: 'Tư vấn thiết kế', text: 'Tư vấn vật liệu, cấu tạo, bố trí công năng và lên bản thiết kế đồng bộ.' },
  { name: 'Báo giá', text: 'Báo giá minh bạch theo từng hạng mục dựa trên thiết kế đã thống nhất.' },
  { name: 'Sản xuất', text: 'Gia công tại xưởng riêng của DOMINO ở Thái Bình, kiểm soát chất lượng từng công đoạn.' },
  { name: 'Thi công', text: 'Lắp đặt và căn chỉnh trực tiếp tại nhà bởi đội ngũ DOMINO.' },
  { name: 'Nghiệm thu', text: 'Kiểm tra, nghiệm thu toàn bộ hạng mục và hướng dẫn sử dụng trước khi bàn giao.' },
  { name: 'Bảo hành và hậu mãi', text: 'Đồng hành bảo hành dài hạn theo từng cấu phần qua chuyên mục Nhà DOMINO bảo hành.' },
];

function buildSeoHeadTags({ origin, settings, overrides }) {
  const canonicalUrl = `${String(origin || '').replace(/\/+$/, '')}/`;
  const title = settings.site_title || 'DOMINO - Tủ bếp INOX cánh kính tại Thái Bình';
  const description =
    settings.site_description ||
    'DOMINO Thái Bình - Tủ bếp INOX cánh kính thiết kế, sản xuất tại xưởng riêng và thi công trọn gói từ năm 2015. Bảo hành khung INOX 20 năm đến trọn đời.';

  // Resolve OG image: CMS SEO og_image -> Hero image CMS override -> default Hero image
  const heroOverrideSrc = overrides?.['img-02']?.value?.src || '';
  const ogImageRel = settings.og_image || heroOverrideSrc || DEFAULT_OG_IMAGE_PATH;
  const ogImageUrl = toAbsoluteUrl(ogImageRel, origin);
  const logoUrl = toAbsoluteUrl(overrides?.['img-01']?.value?.src || DEFAULT_LOGO_PATH, origin);

  const showroomAddr = stripTags(overrides?.['txt-showroom-addr']?.value?.html) || 'Thái Bình';
  const sameAs = [
    overrides?.['link-18']?.value?.href || 'https://www.facebook.com/412021982591419',
    overrides?.['link-19']?.value?.href || 'https://zalo.me/0967862545',
    overrides?.['link-20']?.value?.href || 'https://tubepdomino.vn',
    overrides?.['link-youtube']?.value?.href,
    overrides?.['link-tiktok']?.value?.href,
  ].filter((u) => u && /^https?:\/\//i.test(u));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'HomeAndConstructionBusiness',
        '@id': `${canonicalUrl}#organization`,
        name: 'DOMINO - Tủ bếp INOX cánh kính',
        alternateName: 'DOMINO Glass Kitchen',
        url: canonicalUrl,
        logo: {
          '@type': 'ImageObject',
          url: logoUrl,
        },
        image: ogImageUrl,
        description,
        foundingDate: '2015',
        telephone: '+84967862545',
        priceRange: '$$-$$$',
        address: {
          '@type': 'PostalAddress',
          streetAddress: showroomAddr,
          addressLocality: 'Thái Bình',
          addressRegion: 'Thái Bình',
          addressCountry: 'VN',
        },
        areaServed: [
          { '@type': 'AdministrativeArea', name: 'Thái Bình' },
          { '@type': 'Country', name: 'Việt Nam' },
        ],
        sameAs,
      },
      {
        '@type': 'WebSite',
        '@id': `${canonicalUrl}#website`,
        url: canonicalUrl,
        name: title,
        inLanguage: 'vi-VN',
        publisher: { '@id': `${canonicalUrl}#organization` },
      },
      {
        '@type': 'WebPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: title,
        description,
        inLanguage: 'vi-VN',
        isPartOf: { '@id': `${canonicalUrl}#website` },
        about: { '@id': `${canonicalUrl}#organization` },
        primaryImageOfPage: { '@type': 'ImageObject', url: ogImageUrl },
        speakable: {
          '@type': 'SpeakableSpecification',
          cssSelector: ['h1', '.hero .lead', '#faq summary'],
        },
      },
      {
        '@type': 'ItemList',
        '@id': `${canonicalUrl}#products`,
        name: 'Bốn dòng tủ bếp INOX cánh kính DOMINO',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            item: {
              '@type': 'Product',
              name: 'Tủ bếp INOX cánh kính DOMINO BASIC',
              description:
                'Dòng khởi điểm tập trung công năng hằng ngày. Bảo hành khung INOX 20 năm, cánh kính 3 năm.',
              brand: { '@type': 'Brand', name: 'DOMINO' },
            },
          },
          {
            '@type': 'ListItem',
            position: 2,
            item: {
              '@type': 'Product',
              name: 'Tủ bếp INOX cánh kính DOMINO SIGNATURE',
              description:
                'Dòng trung cấp cân bằng thẩm mỹ, vật liệu và ngân sách. Bảo hành khung INOX 20 năm, cánh kính 5 năm.',
              brand: { '@type': 'Brand', name: 'DOMINO' },
            },
          },
          {
            '@type': 'ListItem',
            position: 3,
            item: {
              '@type': 'Product',
              name: 'Tủ bếp INOX cánh kính DOMINO PREMIUM',
              description:
                'Dòng cao cấp yêu cầu độ hoàn thiện và đồng bộ tổng thể cao. Bảo hành khung INOX 20 năm.',
              brand: { '@type': 'Brand', name: 'DOMINO' },
            },
          },
          {
            '@type': 'ListItem',
            position: 4,
            item: {
              '@type': 'Product',
              name: 'Tủ bếp INOX cánh kính DOMINO VIP (VIP 1 - VIP 3)',
              description:
                'Dòng cao cấp nhất của DOMINO với chính sách bảo hành khung INOX trọn đời.',
              brand: { '@type': 'Brand', name: 'DOMINO' },
            },
          },
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonicalUrl}#faq`,
        mainEntity: FAQ_ITEMS.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.a,
          },
        })),
      },
      {
        '@type': 'HowTo',
        '@id': `${canonicalUrl}#process`,
        name: 'Quy trình 8 bước thiết kế, sản xuất và thi công tủ bếp INOX cánh kính DOMINO',
        step: PROCESS_STEPS.map((s, idx) => ({
          '@type': 'HowToStep',
          position: idx + 1,
          name: s.name,
          text: s.text,
        })),
      },
    ],
  };

  return [
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
    `<meta name="keywords" content="tủ bếp inox cánh kính, tủ bếp inox Thái Bình, tủ bếp DOMINO, tủ bếp inox chống mối mọt, thi công tủ bếp trọn gói, phụ kiện bếp Blum HIGOLD" />`,
    `<meta name="author" content="DOMINO - Tủ bếp INOX cánh kính" />`,
    `<meta name="geo.region" content="VN-20" />`,
    `<meta name="geo.placename" content="${escapeAttr(showroomAddr)}, Việt Nam" />`,
    `<meta property="og:site_name" content="DOMINO - Tủ bếp INOX cánh kính" />`,
    `<meta property="og:url" content="${escapeAttr(canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeAttr(ogImageUrl)}" />`,
    `<meta property="og:image:secure_url" content="${escapeAttr(ogImageUrl)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(ogImageUrl)}" />`,
    `<script type="application/ld+json">${safeJsonLd(jsonLd)}</script>`,
  ].join('\n');
}

function renderRobotsTxt(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    '',
    '# AI Search & Answer Engines (GEO / AEO)',
    'User-agent: Googlebot',
    'Allow: /',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'User-agent: ChatGPT-User',
    'Allow: /',
    'User-agent: PerplexityBot',
    'Allow: /',
    'User-agent: Claude-SearchBot',
    'Allow: /',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

function renderSitemapXml(origin) {
  const base = String(origin || '').replace(/\/+$/, '');
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeAttr(base)}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}

function renderLlmsTxt(origin, settings, overrides) {
  const base = String(origin || '').replace(/\/+$/, '');
  const title = settings.site_title || 'DOMINO - Tủ bếp INOX cánh kính tại Thái Bình';
  const showroom = stripTags(overrides?.['txt-showroom-addr']?.value?.html) || 'Thái Bình';
  const factory = stripTags(overrides?.['txt-factory-addr']?.value?.html) || 'Thái Bình';

  return `# ${title}

> DOMINO là thương hiệu thiết kế, sản xuất tại xưởng riêng và thi công trọn gói tủ bếp INOX cánh kính từ năm 2015 tại Thái Bình, định hướng giải pháp bền đẹp cho căn bếp sử dụng 10–20 năm.

## Thông tin chính
- **Trang chủ**: ${base}/
- **Hotline / Zalo**: 0967 862 545
- **Showroom**: ${showroom}
- **Xưởng sản xuất**: ${factory}
- **Kinh nghiệm**: Hơn 10 năm (từ 2015)

## 4 dòng tủ bếp INOX cánh kính DOMINO
1. **BASIC**: Dòng khởi điểm tập trung công năng sử dụng hằng ngày. Bảo hành khung INOX 20 năm, cánh kính 3 năm.
2. **SIGNATURE**: Dòng trung cấp cân bằng giữa thẩm mỹ, vật liệu và ngân sách. Bảo hành khung INOX 20 năm, cánh kính 5 năm.
3. **PREMIUM**: Dòng cao cấp yêu cầu độ hoàn thiện và đồng bộ tổng thể. Bảo hành khung INOX 20 năm.
4. **VIP (VIP 1 – VIP 3)**: Dòng cao cấp nhất, điểm nhấn không gian bếp. Bảo hành khung INOX trọn đời.

## Vật liệu & Cấu tạo nổi bật
- Khung và thùng INOX sơn hàn tĩnh điện (2 phương án theo ngân sách) — không hút ẩm, không mối mọt, không cong vênh.
- Cánh kính nhập khẩu kết hợp lớp film an toàn mặt sau, bo cánh hợp kim nhôm/inox, tay nắm CNC, khung viền đen hoặc trắng.
- Phụ kiện & thiết bị đồng bộ từ các thương hiệu: HIGOLD, Blum, Eurogold, GrandX, Konox, Bosch.
- Bố trí linh hoạt theo mặt bằng thực tế: Chữ I, Chữ L, Chữ U, kết hợp đảo bếp.

## Quy trình 8 bước
${PROCESS_STEPS.map((s, i) => `${i + 1}. **${s.name}**: ${s.text}`).join('\n')}

## Câu hỏi thường gặp (FAQ)
${FAQ_ITEMS.map((item) => `### ${item.q}\n${item.a}`).join('\n\n')}
`;
}

module.exports = {
  buildSeoHeadTags,
  renderRobotsTxt,
  renderSitemapXml,
  renderLlmsTxt,
};

