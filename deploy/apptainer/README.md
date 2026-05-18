# Apptainer Image

This builds a HiPerGator-targeted image for the Open OnDemand batch app and current alpha extraction code.

## Build Docker Image

```bash
docker build --platform linux/amd64 \
  -f deploy/apptainer/Dockerfile \
  -t volumetric-analysis:cuda-v2.4.2 .
```

## Publish Or Transfer

Preferred: push the image to a registry such as GHCR, then build the SIF on HiPerGator:

```bash
docker tag volumetric-analysis:cuda-v2.4.2 ghcr.io/OWNER/volumetric-analysis:cuda-v2.4.2
docker push ghcr.io/OWNER/volumetric-analysis:cuda-v2.4.2

module load apptainer
apptainer build volumetric-analysis_cuda-v2.4.2.sif \
  docker://ghcr.io/OWNER/volumetric-analysis:cuda-v2.4.2
```

Alternative: save the Docker image and transfer the tarball to HiPerGator:

```bash
docker save volumetric-analysis:cuda-v2.4.2 -o volumetric-analysis_cuda-v2.4.2.tar
module load apptainer
apptainer build volumetric-analysis_cuda-v2.4.2.sif \
  docker-archive://volumetric-analysis_cuda-v2.4.2.tar
```

## Smoke Test On A GPU Node

```bash
apptainer exec --nv volumetric-analysis_cuda-v2.4.2.sif \
  python -c "import torch; print(torch.cuda.is_available())"

apptainer exec --nv volumetric-analysis_cuda-v2.4.2.sif \
  /fastsurfer/run_fastsurfer.sh --version
```
