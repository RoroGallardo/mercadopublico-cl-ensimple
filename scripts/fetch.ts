import fs from 'fs/promises'
import path from 'path'
import 'dotenv/config'

const BASE_URL = 'https://api.mercadopublico.cl/servicios/v1/publico'
const TICKET = process.env.MERCADOPUBLICO_TICKET

if (!TICKET) {
  throw new Error('Falta la variable de entorno MERCADOPUBLICO_TICKET')
}

type Licitacion = {
  CodigoExterno: string
  Nombre: string
  Descripcion: string
  FechaCierre: string
  Comprador: {
    NombreOrganismo: string
  }
  MontoEstimado?: number
}

type ApiResponse = {
  Cantidad: number
  Listado: Licitacion[]
}

const INDUSTRY_KEYWORDS = {
  tecnologia: [
    'software',
    'sistema',
    'tecnología',
    'informática',
    'ti',
    'desarrollo',
    'plataforma',
    'cloud'
  ],
  mineria: [
    'minería',
    'cobre',
    'minero',
    'faena',
    'relaves',
    'perforación',
    'extracción'
  ],
  iot: [
    'iot',
    'sensor',
    'telemetría',
    'automatización',
    'monitoreo',
    'scada',
    'industria 4.0'
  ]
}

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${dd}${mm}${yyyy}`
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

async function fetchLicitaciones(fecha: string): Promise<ApiResponse> {
  const url = `${BASE_URL}/licitaciones.json?fecha=${fecha}&ticket=${TICKET}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Error API Mercado Público (${res.status})`)
  }

  return res.json()
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function main() {
  const today = new Date()
  const fecha = formatDate(today)

  const rawDir = path.resolve('data/raw')
  const processedDir = path.resolve('data/processed')

  await ensureDir(rawDir)
  await ensureDir(processedDir)

  console.log(`📡 Obteniendo licitaciones Mercado Público (${fecha})`)

  const response = await fetchLicitaciones(fecha)

  const rawFile = path.join(rawDir, `licitaciones-${fecha}.json`)
  await fs.writeFile(rawFile, JSON.stringify(response, null, 2))

  const summary = {
    fecha,
    totalLicitaciones: response.Cantidad,
    industrias: {
      tecnologia: { cantidad: 0, montoEstimado: 0 },
      mineria: { cantidad: 0, montoEstimado: 0 },
      iot: { cantidad: 0, montoEstimado: 0 }
    }
  }

  for (const lic of response.Listado) {
    const text = `${lic.Nombre} ${lic.Descripcion}`
    const industry = classifyIndustry(text)

    if (!industry) continue

    summary.industrias[industry].cantidad += 1
    summary.industrias[industry].montoEstimado += lic.MontoEstimado ?? 0
  }

  const processedFile = path.join(
    processedDir,
    `summary-${fecha}.json`
  )

  await fs.writeFile(processedFile, JSON.stringify(summary, null, 2))

  console.log('✅ Datos procesados correctamente')
  console.log(summary)
}

main().catch(err => {
  console.error('❌ Error en fetch Mercado Público')
  console.error(err)
  process.exit(1)
})
