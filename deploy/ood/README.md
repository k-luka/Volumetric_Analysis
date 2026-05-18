# Open OnDemand App

This directory contains a starter Open OnDemand batch app for HiPerGator. It submits a Slurm job that runs the Apptainer container and then exits; it does not keep an interactive browser session alive.

## Development Install

Copy or symlink the app into your OOD development apps folder:

```bash
mkdir -p ~/ondemand/dev
ln -s "$PWD/deploy/ood/brain_volume_analysis" ~/ondemand/dev/brain_volume_analysis
```

Then open Open OnDemand, restart your OOD web server if needed, and launch the app from the development apps area.

If HiPerGator does not expose personal development apps, test the generated command through OOD Job Composer first and then ask UFRC to install or enable the custom OOD app.

## Site Adjustments

Before production use, confirm with UFRC:

- the correct `cluster` value in `form.yml.erb`,
- the required Slurm account, partition, and QoS defaults,
- the final path to the Apptainer `.sif` image,
- which storage roots should be bound into the container.
- whether Slurm email notifications are enabled for the intended users.

The app currently binds `/blue`, `/orange`, `/scratch`, `/ufrc`, and the job temp directory when those paths exist.
