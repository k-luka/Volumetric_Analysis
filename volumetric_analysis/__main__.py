"""Entry point so `python -m volumetric_analysis` launches the local wizard."""

from volumetric_analysis.wizard import main

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
