#!/bin/bash

# Deployment monitoring script with automatic retry logic
# Handles pending transactions and transient RPC errors gracefully

set -euo pipefail

# Configuration
MAX_ATTEMPTS=${MAX_ATTEMPTS:-100}
RETRY_DELAY=${RETRY_DELAY:-30}
SUCCESS_THRESHOLD=${SUCCESS_THRESHOLD:-3}
NETWORK=${1:-ethereum_testnet}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Initialize counters
start_time=$(date +%s)
attempt=0
successful_runs=0
errors=""

echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}Deployment Monitor for Network: $NETWORK${NC}"
echo -e "Starting at $(date)"
echo -e "Configuration:"
echo -e "  • Max attempts: $MAX_ATTEMPTS"
echo -e "  • Retry delay: ${RETRY_DELAY}s"
echo -e "  • Success threshold: $SUCCESS_THRESHOLD consecutive runs"
echo -e "${GREEN}===============================================${NC}\n"

# Main deployment loop
while [ $attempt -lt $MAX_ATTEMPTS ]; do
    attempt=$((attempt + 1))
    
    echo -e "${YELLOW}==========================================${NC}"
    echo -e "${YELLOW}Deployment Run #$attempt at $(date +%H:%M:%S)${NC}"
    echo -e "${YELLOW}==========================================${NC}"
    
    # Run deployment with timing
    cmd_start=$(date +%s)
    
    if yarn hardhat deploy --network "$NETWORK" 2>&1; then
        exit_code=0
    else
        exit_code=$?
    fi
    
    cmd_end=$(date +%s)
    cmd_time=$((cmd_end - cmd_start))
    
    echo -e "\n⏱️  Run took ${cmd_time} seconds (exit code: $exit_code)"
    
    if [ $exit_code -eq 0 ]; then
        successful_runs=$((successful_runs + 1))
        echo -e "${GREEN}✅ Run #$attempt successful (${successful_runs}/${SUCCESS_THRESHOLD})${NC}"
        
        # Check how many contracts are deployed
        if [ -d "deployments/$NETWORK" ]; then
            contract_count=$(ls "deployments/$NETWORK"/*.json 2>/dev/null | grep -v "\.migrations\.json\|\.pendingTransactions" | wc -l | tr -d ' ')
            echo -e "📦 Currently $contract_count contracts deployed"
        fi
        
        # Check if we've reached the success threshold
        if [ $successful_runs -ge $SUCCESS_THRESHOLD ]; then
            echo -e "${GREEN}🎉 Deployment completed after $successful_runs successful runs${NC}"
            break
        fi
        
        echo "Continuing to ensure all contracts are deployed..."
        sleep 3
    else
        successful_runs=0  # Reset counter on failure
        errors="${errors}Run $attempt: exit $exit_code after ${cmd_time}s\n"
        echo -e "${RED}⚠️  Error occurred, waiting ${RETRY_DELAY}s before retry...${NC}"
        sleep $RETRY_DELAY
    fi
done

# Calculate final metrics
end_time=$(date +%s)
total_time=$((end_time - start_time))

# Final contract count
final_count=0
if [ -d "deployments/$NETWORK" ]; then
    final_count=$(ls "deployments/$NETWORK"/*.json 2>/dev/null | grep -v "\.migrations\.json\|\.pendingTransactions" | wc -l | tr -d ' ')
fi

# Print summary
echo ""
echo -e "${GREEN}===============================================${NC}"
echo -e "${GREEN}         DEPLOYMENT SUMMARY${NC}"
echo -e "${GREEN}===============================================${NC}"
echo -e "📊 Metrics:"
echo -e "  • Total deployment runs: $attempt"
echo -e "  • Successful runs: $successful_runs"
echo -e "  • Contracts deployed: $final_count"
echo -e "  • Total time: $((total_time / 60))m $((total_time % 60))s"

if [ -n "$errors" ]; then
    echo -e "\n${YELLOW}⚠️  Errors encountered:${NC}"
    echo -e "$errors"
fi

if [ $successful_runs -ge $SUCCESS_THRESHOLD ]; then
    echo -e "\n${GREEN}✅ Status: SUCCESS${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Status: FAILED${NC}"
    exit 1
fi