#!/usr/bin/env python3
"""
Script para reintentar la creación de una VM en Oracle Cloud (Free Tier) hasta que haya capacidad.

Uso:
  python scripts/create-oracle-vm.py

Variables de entorno requeridas:
  OCI_USER_OCID          - OCID del usuario
  OCI_FINGERPRINT        - Fingerprint de la API key
  OCI_PRIVATE_KEY        - Contenido de la clave privada PEM (o ruta al archivo con OCI_PRIVATE_KEY_FILE)
  OCI_PRIVATE_KEY_FILE   - Ruta al archivo de clave privada (alternativa a OCI_PRIVATE_KEY)
  OCI_TENANCY_OCID       - OCID del tenancy
  OCI_REGION             - Región (ej: sa-santiago-1, us-ashburn-1)
  OCI_COMPARTMENT_OCID   - OCID del compartment donde crear la VM
  OCI_SUBNET_OCID        - OCID de la subnet
  OCI_IMAGE_OCID         - OCID de la imagen (Ubuntu 22.04 ARM, Oracle Linux, etc.)

Variables de entorno opcionales:
  OCI_SHAPE              - Shape (default: VM.Standard.A1.Flex)
  OCI_OCPUS              - OCPUs (default: 4, máximo free tier)
  OCI_MEMORY_GB          - Memoria en GB (default: 24, máximo free tier)
  OCI_INSTANCE_NAME      - Nombre de la instancia (default: free-tier-vm)
  OCI_SSH_PUBLIC_KEY     - Clave SSH pública para acceso
  RETRY_INTERVAL_SECONDS - Segundos entre reintentos (default: 60)
  MAX_RETRIES            - Máximo de reintentos (default: 0 = infinito)
"""

import os
import sys
import time
import json
import logging
import tempfile
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# Errores de OCI que indican falta de capacidad → deben reintentarse
OUT_OF_CAPACITY_CODES = {
    "InternalError",
    "NotAuthorizedOrNotFound",
}
OUT_OF_CAPACITY_MESSAGES = [
    "out of capacity",
    "out of host capacity",
    "no capacity available",
    "insufficient capacity",
    "host capacity unavailable",
]


def _is_capacity_error(exc) -> bool:
    """Devuelve True si el error es de capacidad y vale la pena reintentar."""
    msg = str(exc).lower()
    return any(phrase in msg for phrase in OUT_OF_CAPACITY_MESSAGES)


def load_config() -> dict:
    required = [
        "OCI_USER_OCID",
        "OCI_FINGERPRINT",
        "OCI_TENANCY_OCID",
        "OCI_REGION",
        "OCI_COMPARTMENT_OCID",
        "OCI_SUBNET_OCID",
        "OCI_IMAGE_OCID",
    ]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        log.error("Faltan variables de entorno: %s", ", ".join(missing))
        sys.exit(1)

    private_key_content = os.environ.get("OCI_PRIVATE_KEY", "")
    private_key_file = os.environ.get("OCI_PRIVATE_KEY_FILE", "")
    if not private_key_content and not private_key_file:
        log.error("Debes definir OCI_PRIVATE_KEY o OCI_PRIVATE_KEY_FILE")
        sys.exit(1)

    return {
        "user": os.environ["OCI_USER_OCID"],
        "fingerprint": os.environ["OCI_FINGERPRINT"],
        "tenancy": os.environ["OCI_TENANCY_OCID"],
        "region": os.environ["OCI_REGION"],
        "compartment_id": os.environ["OCI_COMPARTMENT_OCID"],
        "subnet_id": os.environ["OCI_SUBNET_OCID"],
        "image_id": os.environ["OCI_IMAGE_OCID"],
        "private_key_content": private_key_content,
        "private_key_file": private_key_file,
        "shape": os.environ.get("OCI_SHAPE", "VM.Standard.A1.Flex"),
        "ocpus": float(os.environ.get("OCI_OCPUS", "4")),
        "memory_gb": float(os.environ.get("OCI_MEMORY_GB", "24")),
        "instance_name": os.environ.get("OCI_INSTANCE_NAME", "free-tier-vm"),
        "ssh_public_key": os.environ.get("OCI_SSH_PUBLIC_KEY", ""),
        "retry_interval": int(os.environ.get("RETRY_INTERVAL_SECONDS", "60")),
        "max_retries": int(os.environ.get("MAX_RETRIES", "0")),
    }


def build_oci_config(cfg: dict) -> tuple:
    """Construye el dict de configuración de OCI y la ruta a la clave privada."""
    try:
        import oci  # noqa: F401
    except ImportError:
        log.error("El SDK de OCI no está instalado. Ejecuta: pip install oci")
        sys.exit(1)

    tmp_key_file = None

    if cfg["private_key_content"]:
        key_content = cfg["private_key_content"].replace("\\n", "\n")
        tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False)
        tmp.write(key_content)
        tmp.close()
        key_file = tmp.name
        tmp_key_file = key_file
    else:
        key_file = cfg["private_key_file"]

    oci_config = {
        "user": cfg["user"],
        "fingerprint": cfg["fingerprint"],
        "tenancy": cfg["tenancy"],
        "region": cfg["region"],
        "key_file": key_file,
    }

    return oci_config, tmp_key_file


def instance_already_exists(compute_client, compartment_id: str, name: str) -> bool:
    """Comprueba si ya existe una instancia con ese nombre en estado RUNNING o PROVISIONING."""
    try:
        import oci

        instances = oci.pagination.list_call_get_all_results(
            compute_client.list_instances,
            compartment_id,
            display_name=name,
        ).data
        active_states = {"RUNNING", "PROVISIONING", "STARTING"}
        for inst in instances:
            if inst.lifecycle_state in active_states:
                log.info(
                    "Instancia '%s' ya existe (OCID: %s, estado: %s)",
                    name,
                    inst.id,
                    inst.lifecycle_state,
                )
                return True
    except Exception as e:
        log.warning("No se pudo verificar instancias existentes: %s", e)
    return False


def try_create_instance(compute_client, cfg: dict):
    """
    Intenta crear la instancia. Devuelve el objeto instancia si tiene éxito.
    Lanza excepción si falla.
    """
    import oci

    launch_details = oci.core.models.LaunchInstanceDetails(
        compartment_id=cfg["compartment_id"],
        display_name=cfg["instance_name"],
        shape=cfg["shape"],
        shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
            ocpus=cfg["ocpus"],
            memory_in_gbs=cfg["memory_gb"],
        ),
        source_details=oci.core.models.InstanceSourceViaImageDetails(
            source_type="image",
            image_id=cfg["image_id"],
        ),
        create_vnic_details=oci.core.models.CreateVnicDetails(
            subnet_id=cfg["subnet_id"],
            assign_public_ip=True,
        ),
        metadata=(
            {"ssh_authorized_keys": cfg["ssh_public_key"]}
            if cfg["ssh_public_key"]
            else {}
        ),
    )

    response = compute_client.launch_instance(launch_details)
    return response.data


def wait_for_running(compute_client, instance_id: str, timeout: int = 600):
    """Espera hasta que la instancia esté en estado RUNNING."""
    import oci

    log.info("Esperando que la instancia esté RUNNING (timeout: %ds)...", timeout)
    client_composite = oci.core.ComputeClientCompositeOperations(compute_client)
    result = client_composite.launch_instance_and_wait_for_state(
        # ya está creada, solo usamos get_instance
        # usamos get directamente
        instance_id,
        wait_for_states=[oci.core.models.Instance.LIFECYCLE_STATE_RUNNING],
        waiter_kwargs={"max_wait_seconds": timeout},
    )
    return result


def print_instance_summary(instance) -> None:
    log.info("=" * 60)
    log.info("VM CREADA EXITOSAMENTE")
    log.info("  OCID      : %s", instance.id)
    log.info("  Nombre    : %s", instance.display_name)
    log.info("  Shape     : %s", instance.shape)
    log.info("  Region    : %s", instance.region)
    log.info("  Estado    : %s", instance.lifecycle_state)
    log.info("=" * 60)


def main():
    cfg = load_config()
    oci_config, tmp_key_file = build_oci_config(cfg)

    import oci

    oci.config.validate_config(oci_config)
    compute_client = oci.core.ComputeClient(oci_config)

    retry_interval = cfg["retry_interval"]
    max_retries = cfg["max_retries"]
    attempt = 0

    log.info("Iniciando reintento continuo de creación de VM Free Tier")
    log.info(
        "  Shape: %s | OCPUs: %s | Memoria: %s GB",
        cfg["shape"],
        cfg["ocpus"],
        cfg["memory_gb"],
    )
    log.info(
        "  Intervalo de reintento: %ds | Max reintentos: %s",
        retry_interval,
        max_retries if max_retries > 0 else "∞",
    )

    if instance_already_exists(compute_client, cfg["compartment_id"], cfg["instance_name"]):
        log.info("La instancia ya existe. No se requiere crear una nueva.")
        _cleanup(tmp_key_file)
        sys.exit(0)

    while True:
        attempt += 1
        log.info("--- Intento #%d ---", attempt)

        try:
            instance = try_create_instance(compute_client, cfg)
            print_instance_summary(instance)

            # Guardar resumen en archivo para pipelines CI
            summary = {
                "instance_id": instance.id,
                "display_name": instance.display_name,
                "shape": instance.shape,
                "region": instance.region,
                "lifecycle_state": instance.lifecycle_state,
                "created_at": datetime.utcnow().isoformat() + "Z",
                "attempts": attempt,
            }
            out_path = os.path.join(
                os.path.dirname(__file__), "..", "data", "oracle-vm-created.json"
            )
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with open(out_path, "w") as f:
                json.dump(summary, f, indent=2)
            log.info("Resumen guardado en data/oracle-vm-created.json")
            _cleanup(tmp_key_file)
            sys.exit(0)

        except oci.exceptions.ServiceError as e:
            if _is_capacity_error(e):
                log.warning(
                    "Sin capacidad disponible (HTTP %d: %s). Reintentando en %ds...",
                    e.status,
                    e.message,
                    retry_interval,
                )
            else:
                log.error("Error de servicio OCI: %s", e)
                _cleanup(tmp_key_file)
                sys.exit(1)
        except Exception as e:
            log.error("Error inesperado: %s", e)
            _cleanup(tmp_key_file)
            sys.exit(1)

        if max_retries > 0 and attempt >= max_retries:
            log.error("Se alcanzó el máximo de %d reintentos sin éxito.", max_retries)
            _cleanup(tmp_key_file)
            sys.exit(1)

        time.sleep(retry_interval)


def _cleanup(tmp_key_file):
    if tmp_key_file and os.path.exists(tmp_key_file):
        os.unlink(tmp_key_file)


if __name__ == "__main__":
    main()
