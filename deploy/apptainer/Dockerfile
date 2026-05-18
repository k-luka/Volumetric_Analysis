FROM deepmi/fastsurfer:cuda-v2.4.2

USER root
WORKDIR /opt/volumetric-analysis

COPY requirements.txt README.md ./
COPY config ./config
COPY volumetric_analysis ./volumetric_analysis

RUN python -m pip install --no-cache-dir -r requirements.txt

ENV PYTHONPATH="/opt/volumetric-analysis:${PYTHONPATH}" \
    PYTHONUNBUFFERED=1 \
    VA_FASTSURFER_EXECUTABLE=/fastsurfer/run_fastsurfer.sh \
    VA_FASTSURFER_DEVICE=cuda

USER nonroot

ENTRYPOINT ["/fastsurfer/Docker/entrypoint.sh", "python", "-m", "volumetric_analysis.run"]
