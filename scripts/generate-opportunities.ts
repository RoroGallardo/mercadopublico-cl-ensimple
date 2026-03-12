import fs from 'fs/promises'
import path from 'path'

const RAW_DIR = path.resolve('data/raw')
const PROCESSED_DIR = path.resolve('data/processed')

type Licitacion = {
  CodigoExterno: string
  Nombre: string
  Descripcion: string
  FechaCierre: string
  Comprador: {
    NombreOrganismo: string
  }
  Tipo?: string
}

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  tecnologia: [
    'software',
    'sistema',
    'plataforma',
    'informática',
    'tecnología',
    'desarrollo',
    'ti',
    'cloud'
  ],
  mineria: [
    'minería',
    'minero',
    'cobre',
    'faena',
    'relaves',
    'extracción',
    'perforación'
  ]
}

function classifyIndustry(text: string): string | null {
  const content = text.toLowerCase()

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (keywords.some(k => content.includes(k))) {
      return industry
    }
  }
  return null
}

function isOpen(fechaCierre: string): boolean {
  return new Date(fechaCierre) > new Date()
}

function buildUrl(codigo: string): string {
  return `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?qs=${codigo}`
}

function parseDDMMYYYY(filename: string): number {
  // filename format: licitaciones-DDMMYYYY.json
  const match = filename.match(/licitaciones-(\d{2})(\d{2})(\d{4})\.json/)
  if (!match) return 0
  const [, dd, mm, yyyy] = match
  return parseInt(`${yyyy}${mm}${dd}`, 10)
}

async function getLatestRaw(): Promise<Licitacion[]> {
  const files = await fs.readdir(RAW_DIR)

  const targets = files
    .filter(f => f.startsWith('licitaciones-') && f.endsWith('.json'))
    .sort((a, b) => parseDDMMYYYY(a) - parseDDMMYYYY(b))
    .reverse()

  if (!targets.length) {
    throw new Error('No hay archivos raw de licitaciones')
  }

  const content = JSON.parse(
    await fs.readFile(path.join(RAW_DIR, targets[0]), 'utf-8')
  )

  return (content.Listado ?? []) as Licitacion[]
}

async function main() {
  const licitaciones = await getLatestRaw()
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const opportunities: Record<string, any[]> = {
    fecha,
    tecnologia: [],
    mineria: []
  }

  for (const lic of licitaciones) {
    if (!isOpen(lic.FechaCierre)) continue

    const text = `${lic.Nombre} ${lic.Descripcion}`
    const industry = classifyIndustry(text)

    if (!industry) continue

    opportunities[industry].push({
      codigo: lic.CodigoExterno,
      nombre: lic.Nombre,
      organismo: lic.Comprador?.NombreOrganismo ?? 'No informado',
      fechaCierre: lic.FechaCierre.slice(0, 10),
      tipo: lic.Tipo ?? 'No especificado',
      url: buildUrl(lic.CodigoExterno)
    })
  }

  for (const industry of ['tecnologia', 'mineria']) {
    opportunities[industry] = opportunities[industry]
      .sort(
        (a, b) =>
          new Date(a.fechaCierre).getTime() -
          new Date(b.fechaCierre).getTime()
      )
      .slice(0, 30)
  }

  await fs.mkdir(PROCESSED_DIR, { recursive: true })

  const outputFile = path.join(
    PROCESSED_DIR,
    `opportunities-${fecha}.json`
  )

  await fs.writeFile(outputFile, JSON.stringify(opportunities, null, 2))

  console.log('🎯 Oportunidades generadas')
  console.log(
    Object.fromEntries(
      Object.entries(opportunities)
        .filter(([k]) => k !== 'fecha')
        .map(([k, v]) => [k, v.length])
    )
  )
}

main().catch(err => {
  console.error('❌ Error generando oportunidades')
  console.error(err)
  process.exit(1)
})
